package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.history.invoiceJson
import com.aarogyam.staff.history.items
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Instant

/** A10/R8: the collect sheet reads the balance again, issues a draft, refetches on 409, and closes with the notification. */
@OptIn(ExperimentalCoroutinesApi::class)
class DeskCollectRaceTest {
    private val invoice = "$SUNRISE/api/v1/invoices/i1"
    private val summary = "$SUNRISE/api/v1/invoices/i1/collect-summary"
    private val issue = "$SUNRISE/api/v1/invoices/i1/issue"
    private val payments = "$SUNRISE/api/v1/payments"
    private val list = "$SUNRISE/api/v1/invoices"
    private val billing = listOf("billing.read", "billing.write")
    private val ended = Instant.parse("2026-10-08T04:00:00Z")

    private fun summaryJson(
        status: String,
        total: Long,
        balance: Long,
    ) = """{"invoice_id":"i1","number":${if (status == "draft") "null" else "\"INV-i1\""},"status":"$status",
        "patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"total_paise":$total,"balance_paise":$balance,
        "upi":{"uri":"upi://pay?pa=clinic@bank","qr_data":"upi://pay?pa=clinic@bank","upi_id":"clinic@bank","payee_name":"Sunrise"}}"""

    private fun order(backend: FakeBackend) = backend.requests.map { it.url.encodedPath.substringAfter("/api/v1/") }

    private fun paid(backend: FakeBackend) =
        backend.on(
            payments,
            {
                json(
                    """{"id":"pay1","number":"RC/1","patient":{"id":"p1","number":"SD-1042","name":"Meera Shah"},
                      "received_at":"2026-10-08T04:00:00Z","amount_paise":5000,"method":"cash","status":"received",
                      "allocated_paise":5000,"unallocated_paise":0,"allocations":[]}""",
                    HttpStatusCode.Created,
                )
            },
        )

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        now: Instant = ended,
    ): DeskPaymentStateHolder {
        backend.on(list, { json(items(invoiceJson("i1", "v1", 5000, 0))) })
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, billing)
        return DeskPaymentStateHolder(clinic, "p1", backgroundScope, graph, clock = { now })
    }

    @Test
    fun the_invoice_is_read_again_before_the_payment_and_its_balance_sets_the_allocation() =
        runTest {
            val backend = FakeBackend()
            // The list said 5000; the bill now owes 3000 (a part payment came in).
            backend.on(summary, { json(summaryJson("issued", 5000, 3000)) })
            paid(backend)
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            val before = backend.requests.size
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            assertEquals(listOf("invoices/i1/collect-summary", "payments"), order(backend).drop(before).take(2))
            val body =
                backend.requests
                    .first { it.url.encodedPath.endsWith("/payments") }
                    .body
                    .toString()
            assertTrue(body.isNotEmpty())
            assertIs<DeskPayOutcome.Recorded>(h.outcome.value)
            val due = (h.state.value as DeskPayState.Ready).dues.single()
            assertEquals("upi://pay?pa=clinic@bank", due.upi?.uri)
        }

    @Test
    fun a_zero_balance_shows_already_paid_and_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson("issued", 5000, 0)) })
            paid(backend)
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            assertEquals(DeskPayOutcome.AlreadyPaid, h.outcome.value)
            assertEquals(0, backend.count(payments))
            assertEquals(0, backend.count(issue))
        }

    @Test
    fun a_draft_is_paid_by_its_total_and_never_issued_by_the_phone() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson("draft", 5000, 5000)) })
            paid(backend)
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            val before = backend.requests.size
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            assertEquals(listOf("invoices/i1/collect-summary", "payments"), order(backend).drop(before).take(2))
            assertEquals(0, backend.count(issue))
            assertIs<DeskPayOutcome.Recorded>(h.outcome.value)
        }

    @Test
    fun a_409_refetches_the_bill_and_shows_the_server_state() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson("issued", 5000, 5000)) })
            backend.on(invoice, { json(invoiceJson("i1", "v1", 5000, 5000)) })
            backend.on(payments, { apiError(HttpStatusCode.Conflict, "conflict") })
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            val before = backend.requests.size
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            // GET (race check), POST (409), GET again, then the list reload.
            assertEquals(
                listOf("invoices/i1/collect-summary", "payments", "invoices/i1"),
                order(backend).drop(before).take(3),
            )
            assertEquals(DeskPayOutcome.AlreadyPaid, h.outcome.value)
        }

    @Test
    fun a_409_with_a_balance_left_is_a_failure_and_the_list_reloads() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson("issued", 5000, 5000)) })
            backend.on(payments, { apiError(HttpStatusCode.Conflict, "conflict") })
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            until { h.state.value is DeskPayState.Ready }
            val lists = backend.count(list)
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            assertIs<DeskPayOutcome.Failed>(h.outcome.value)
            until { backend.count(list) == lists + 1 }
            assertEquals(lists + 1, backend.count(list))
        }

    @Test
    fun the_card_closes_when_the_notification_is_handled() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/notifications",
                {
                    json(
                        """{"items":[
                          {"id":"n1","kind":"collect_payment","read":false,"created_at":"2026-10-08T04:00:00Z",
                           "handled":{"at":"2026-10-08T04:01:00Z","name":"Dr. Patil"}},
                          {"id":"n2","kind":"collect_payment","read":false,"created_at":"2026-10-08T04:00:00Z","handled":null}]}""",
                    )
                },
            )
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            assertTrue(h.cardOpen.value)
            h.checkHandled("n2")
            until { backend.count("$SUNRISE/api/v1/notifications") == 1 }
            runCurrent()
            assertTrue(h.cardOpen.value, "an unhandled row keeps the card")
            h.checkHandled("n1")
            until { !h.cardOpen.value }
            assertFalse(h.cardOpen.value)
            assertTrue(ServerCaps.notificationAudience)
        }

    @Test
    fun without_the_handled_field_the_card_stays_open() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/notifications",
                {
                    json(
                        """{"items":[{"id":"n1","kind":"collect_payment","read":false,"created_at":"2026-10-08T04:00:00Z"}]}""",
                    )
                },
            )
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            h.checkHandled("n1")
            until { backend.count("$SUNRISE/api/v1/notifications") == 1 }
            runCurrent()
            assertTrue(h.cardOpen.value)
            assertFalse(ServerCaps.notificationAudience)
        }

    @Test
    fun a_zero_balance_closes_the_card() =
        runTest {
            val backend = FakeBackend()
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            backend.on(list, { json(items(invoiceJson("i1", "v1", 5000, 5000))) })
            h.refresh()
            h.state.first { it is DeskPayState.Ready && it.dues.isEmpty() }
            assertFalse(h.cardOpen.value)
        }

    @Test
    fun the_doctor_may_be_collecting_for_two_minutes_after_the_visit_closes() {
        fun at(seconds: Long) = ended + kotlin.time.Duration.parse("${seconds}s")
        assertTrue(doctorMayBeCollecting("ready_to_bill", ended, at(0)))
        assertTrue(doctorMayBeCollecting("ready_to_bill", ended, at(119)))
        assertFalse(doctorMayBeCollecting("ready_to_bill", ended, at(120)))
        assertFalse(doctorMayBeCollecting("ready_to_bill", ended, at(600)))
        assertFalse(doctorMayBeCollecting("done", ended, at(10)))
        assertFalse(doctorMayBeCollecting("ready_to_bill", null, at(10)))
    }

    @Test
    fun the_holder_reads_the_window_from_its_injected_clock() =
        runTest {
            val backend = FakeBackend()
            val inside = holder(backend, ended + kotlin.time.Duration.parse("90s"))
            assertTrue(inside.doctorMayBeCollecting("ready_to_bill", "2026-10-08T04:00:00Z"))
            val outside = holder(FakeBackend(), ended + kotlin.time.Duration.parse("150s"))
            assertFalse(outside.doctorMayBeCollecting("ready_to_bill", "2026-10-08T04:00:00Z"))
        }
}

/** Waits in real time for [cond]: the mock engine answers on its own threads, so virtual time does not help. */
internal suspend fun until(cond: () -> Boolean) =
    withContext(Dispatchers.Default) { withTimeout(5_000) { while (!cond()) delay(5) } }
