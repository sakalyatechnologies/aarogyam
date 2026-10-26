package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.PollingUpdates
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.history.invoiceJson
import com.aarogyam.staff.history.items
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.outbox.ManualConnectivity
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.queue.TokenStatus
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.Logger
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** D4/D1: a draft bill is issued (`POST /invoices/{id}/issue`), then paid, in that order; also from the outbox. */
@OptIn(ExperimentalCoroutinesApi::class)
class DeskIssueAndPayTest {
    private val issue = "$SUNRISE/api/v1/invoices/d1/issue"
    private val payments = "$SUNRISE/api/v1/payments"
    private val key = "0192f3a4-5b6c-7d8e-9f01-23456789abcd"
    private val billing = listOf("billing.read", "billing.write")

    private suspend fun HttpRequestData.text() = body.toByteArray().decodeToString()

    // A draft reads a balance of 0 (D1) while its total is 240000.
    private fun draftJson() =
        invoiceJson("d1", "v1", 240000, 0, "draft").replace("\"balance_paise\":240000", "\"balance_paise\":0")

    private fun paid(backend: FakeBackend) =
        backend.on(
            payments,
            {
                json(
                    """{"id":"pay1","number":"RC/1","patient":{"id":"p1","number":"SD-1042","name":"Meera Shah"},
                      "received_at":"2026-10-08T04:00:00Z","amount_paise":240000,"method":"cash","status":"received",
                      "allocated_paise":240000,"unallocated_paise":0,"allocations":[]}""",
                    HttpStatusCode.Created,
                )
            },
        )

    private fun job(issueFirst: Boolean = true) =
        PaymentJob(
            "sunrise",
            "p1",
            PayMethod.Cash.name,
            240000,
            invoiceId = "d1",
            allocatedPaise = 240000,
            issueFirst = issueFirst,
        )

    private fun order(backend: FakeBackend) = backend.requests.map { it.url.encodedPath.substringAfter("/api/v1/") }

    private suspend fun TestScope.clinic(backend: FakeBackend) =
        openClinic(backend, testGraph(backend, backgroundScope), this, billing)

    @Test
    fun a_draft_is_issued_then_paid_and_the_issued_balance_sets_the_allocation() =
        runTest {
            val backend = FakeBackend()
            // GST and round-off: the issued bill owes a little more than the draft preview.
            backend.on(issue, { json(invoiceJson("d1", "v1", 252000, 0)) })
            paid(backend)
            val done = deliver(clinic(backend).api, job().copy(amountPaise = 300000), key, Logger("t"))
            assertEquals(Delivery.Done("RC/1", ProofStatus.None), done)
            assertEquals(listOf("invoices/d1/issue", "payments"), order(backend).takeLast(2))
            assertTrue(""""amount_paise":252000""" in backend.requests.last().text(), "allocated to the issued balance")
        }

    @Test
    fun an_issued_bill_is_paid_without_issuing_again() =
        runTest {
            val backend = FakeBackend()
            paid(backend)
            deliver(clinic(backend).api, job(issueFirst = false), key, Logger("t"))
            assertEquals(0, backend.count(issue))
        }

    @Test
    fun a_draft_that_cannot_be_issued_yet_sends_no_payment_and_retries_the_entry() =
        runTest {
            val backend = FakeBackend()
            backend.on(issue, { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") })
            paid(backend)
            assertIs<Delivery.Retry>(deliver(clinic(backend).api, job(), key, Logger("t")))
            assertEquals(0, backend.count(payments))
        }

    @Test
    fun a_refused_issue_is_rejected_and_nothing_is_paid() =
        runTest {
            val backend = FakeBackend()
            backend.on(issue, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            paid(backend)
            assertIs<Delivery.Rejected>(deliver(clinic(backend).api, job(), key, Logger("t")))
            assertEquals(0, backend.count(payments))
        }

    @Test
    fun already_issued_conflict_still_pays_with_the_queued_allocation() =
        runTest {
            val backend = FakeBackend()
            backend.on(issue, { apiError(HttpStatusCode.Conflict, "conflict") })
            paid(backend)
            assertIs<Delivery.Done>(deliver(clinic(backend).api, job(), key, Logger("t")))
            assertTrue(""""amount_paise":240000""" in backend.requests.last().text())
        }

    @Test
    fun offline_the_draft_payment_waits_and_then_issues_before_it_pays() =
        runTest {
            val backend = FakeBackend()
            backend.on(issue, { json(invoiceJson("d1", "v1", 240000, 0)) })
            paid(backend)
            val api = clinic(backend).api
            val net = ManualConnectivity(online = false)
            val sender =
                OutboxSender { entry ->
                    when (val d = deliver(api, decodedJob(entry.payload), entry.id, Logger("t"))) {
                        is Delivery.Done -> SendResult.Delivered
                        is Delivery.Retry -> SendResult.Retry(d.code)
                        is Delivery.Rejected -> SendResult.Rejected(d.code)
                    }
                }
            val runner = OutboxRunner(MemoryOutboxStore(), sender, net, { 1_000L })
            val before = backend.requests.size
            // The job travels as the outbox's text payload.
            runner.enqueue(OutboxKind.Payment, encodeJob(job()), key)
            assertEquals(0, runner.drain(), "offline: nothing goes out")
            assertEquals(before, backend.requests.size)
            net.online.value = true
            assertEquals(1, runner.drain())
            assertEquals(listOf("invoices/d1/issue", "payments"), order(backend).drop(before))
            assertEquals(0, runner.drain(), "delivered once: a second drain sends nothing")
        }

    @Test
    fun the_sheet_lists_a_draft_with_its_total_as_the_amount_due() =
        runTest {
            val backend = FakeBackend()
            // The list carries no lines, so it reads the draft's total as 0; the bill itself has the preview.
            backend.on("$SUNRISE/api/v1/invoices/d1", { json(draftJson()) })
            backend.on(
                "$SUNRISE/api/v1/invoices",
                {
                    json(
                        items(
                            draftJson().replace("\"total_paise\":240000", "\"total_paise\":0"),
                            invoiceJson("i2", "v2", 5000, 5000),
                            invoiceJson("i3", "v3", 7000, 2000, "void"),
                        ),
                    )
                },
            )
            val ctx = clinic(backend)
            val holder = DeskPaymentStateHolder(ctx, "p1", backgroundScope, testGraph(backend, backgroundScope))
            val ready = assertIs<DeskPayState.Ready>(holder.state.first { it is DeskPayState.Ready })
            assertEquals(listOf(DueBill("d1", "INV-d1", 240000, draft = true)), ready.dues)
        }

    @Test
    fun due_bills_follow_status() {
        assertEquals(DueBill("a", "N", 50, draft = false), dueBillOf("a", "N", "issued", 100, 50))
        assertEquals(DueBill("a", null, 100, draft = true), dueBillOf("a", null, "draft", 100, 0))
        assertNull(dueBillOf("a", null, "issued", 100, 0))
        assertNull(dueBillOf("a", null, "void", 100, 100))
        assertNull(dueBillOf("a", null, "draft", 0, 0))
    }

    // Token statuses and polling.

    @Test
    fun called_and_ready_to_bill_decode_and_an_unknown_value_stays_safe() {
        assertEquals(TokenStatus.Called, TokenStatus.of("called"))
        assertEquals(TokenStatus.ReadyToBill, TokenStatus.of("ready_to_bill"))
        assertEquals(TokenStatus.Waiting, TokenStatus.of("waiting"))
        assertEquals(TokenStatus.Unknown, TokenStatus.of("on_hold"))
        assertEquals(TokenStatus.Unknown, TokenStatus.of(""))
        assertTrue(TokenStatus.Called.active && TokenStatus.ReadyToBill.active)
        assertTrue(!TokenStatus.Done.active && !TokenStatus.Unknown.active)
    }

    @Test
    fun polling_starts_after_one_interval_and_stops_when_collection_is_cancelled() =
        runTest {
            var ticks = 0
            val job = launch { PollingUpdates().changes().collect { ticks++ } }
            runCurrent()
            advanceTimeBy(PollingUpdates.POLL_MILLIS - 1)
            assertEquals(0, ticks, "no reload before the first interval")
            advanceTimeBy(2)
            assertEquals(1, ticks)
            advanceTimeBy(PollingUpdates.POLL_MILLIS)
            assertEquals(2, ticks)
            job.cancel()
            advanceTimeBy(PollingUpdates.POLL_MILLIS * 5)
            assertEquals(2, ticks, "off screen or in the background: no more reloads")
        }

    private fun decodedJob(text: String): PaymentJob =
        kotlinx.serialization.json.Json
            .decodeFromString(text)
}
