package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.model.ToCollectItem
import com.aarogyam.staff.apiError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.history.invoiceJson
import com.aarogyam.staff.history.items
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Collect per patient: one payment split over the bills, oldest first, never above a bill's balance. */
class DeskCollectAllTest {
    private val payments = "$SUNRISE/api/v1/payments"
    private val billing = listOf("billing.read", "billing.write")

    @Test
    fun the_oldest_bill_is_settled_in_full_before_the_next() {
        val older = DueBill("i1", "INV-1", 5000)
        val newer = DueBill("i2", "INV-2", 3000)
        assertEquals(
            listOf(BillShare("i1", "INV-1", 5000), BillShare("i2", "INV-2", 1000)),
            allocateOldestFirst(listOf(older, newer), 6000),
        )
        assertEquals(listOf(BillShare("i1", "INV-1", 2000)), allocateOldestFirst(listOf(older, newer), 2000))
        assertEquals(
            8000,
            allocateOldestFirst(listOf(older, newer), 20000).sumOf {
                it.amountPaise
            },
            "the rest stays as an advance",
        )
    }

    @Test
    fun the_to_collect_list_has_one_row_per_patient() {
        fun item(
            token: String,
            patient: String,
            balance: Long,
        ) = ToCollectItem(
            balancePaise = balance,
            day = "2026-11-0$token",
            invoiceId = "i$token",
            patientId = patient,
            patientNumber = "SD-$patient",
            tokenId = "t$token",
            tokenNumber = token.toInt(),
        )
        val rows = patientsOf(listOf(item("1", "p1", 5000), item("2", "p2", 700), item("3", "p1", 3000)))
        assertEquals(listOf("p1", "p2"), rows.map { it.patientId })
        assertEquals(8000, rows.first().totalPaise)
        assertEquals(2, rows.first().billCount)
    }

    private suspend fun TestScope.holder(backend: FakeBackend): DeskPaymentStateHolder {
        // The list is newest first: i2 is the newer bill.
        backend.on("$SUNRISE/api/v1/invoices", {
            json(items(invoiceJson("i2", "v2", 3000, 0), invoiceJson("i1", "v1", 5000, 0)))
        })
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, billing)
        return DeskPaymentStateHolder(clinic, "p1", backgroundScope, graph)
    }

    @Test
    fun one_payment_carries_the_split_and_a_retry_keeps_its_key() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/invoices/i1", { json(invoiceJson("i1", "v1", 5000, 0)) })
            backend.on("$SUNRISE/api/v1/invoices/i2", { json(invoiceJson("i2", "v2", 3000, 0)) })
            backend.on(payments, { apiError(HttpStatusCode.Conflict, "conflict") })
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            assertEquals(listOf("i1", "i2"), h.splitBills().map { it.id })
            assertEquals(listOf(5000L, 1000L), h.split(6000).map { it.amountPaise })
            h.recordAll(6000, PayMethod.Cash, null)
            until { h.outcome.value is DeskPayOutcome.Failed }
            h.recordAll(6000, PayMethod.Cash, null)
            until { backend.requests.count { it.url.encodedPath == "/api/v1/payments" } == 2 }
            val sent = backend.requests.filter { it.url.encodedPath == "/api/v1/payments" }
            assertEquals(1, sent.map { it.headers["Idempotency-Key"] }.distinct().size, "the same split reuses its key")
            val body =
                sent
                    .first()
                    .body
                    .toByteArray()
                    .decodeToString()
            val i1 = body.indexOf(""""invoice_id":"i1"""")
            assertTrue(i1 in 0..<body.indexOf(""""invoice_id":"i2""""), body)
            assertTrue(""""amount_paise":6000""" in body && """"amount_paise":1000""" in body, body)
        }

    @Test
    fun a_bill_that_owes_less_now_shows_the_new_balance_and_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/invoices/i1", { json(invoiceJson("i1", "v1", 5000, 3000)) })
            backend.on("$SUNRISE/api/v1/invoices/i2", { json(invoiceJson("i2", "v2", 3000, 0)) })
            val h = holder(backend)
            until { h.state.value is DeskPayState.Ready }
            h.recordAll(8000, PayMethod.Upi, null)
            until { h.outcome.value is DeskPayOutcome.BalanceChanged }
            assertEquals(5000, assertIs<DeskPayOutcome.BalanceChanged>(h.outcome.value).balancePaise)
            assertEquals(0, backend.requests.count { it.url.encodedPath == "/api/v1/payments" })
        }
}
