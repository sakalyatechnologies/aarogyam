package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.history.invoiceJson
import com.aarogyam.staff.history.items
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull

/** An assistant holds `payments.collect` only: the holder reads one bill by collect-summary and never `/invoices`. */
class DeskAssistantPayTest {
    private val summary = "$SUNRISE/api/v1/invoices/i1/collect-summary"
    private val invoice = "$SUNRISE/api/v1/invoices/i1"
    private val list = "$SUNRISE/api/v1/invoices"
    private val payments = "$SUNRISE/api/v1/payments"
    private val assistant = listOf("payments.collect")
    private val finance = listOf("billing.read", "billing.write")

    private fun summaryJson(balance: Long) =
        """{"invoice_id":"i1","number":"INV-i1","status":"issued",
        "patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"total_paise":5000,"balance_paise":$balance,
        "upi":{"uri":"upi://pay?pa=clinic@bank","qr_data":"upi://pay?pa=clinic@bank","upi_id":"clinic@bank","payee_name":"Sunrise"}}"""

    private fun paths(backend: FakeBackend) = backend.requests.map { it.url.encodedPath.substringAfter("/api/v1/") }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        perms: List<String>,
        invoiceId: String?,
    ): DeskPaymentStateHolder {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, perms)
        return DeskPaymentStateHolder(clinic, "p1", backgroundScope, graph, invoiceId)
    }

    @Test
    fun an_assistant_loads_one_bill_with_one_request_and_its_upi() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson(5000)) })
            val h = holder(backend, assistant, "i1")
            until { h.state.value is DeskPayState.Ready }
            val ready = assertIs<DeskPayState.Ready>(h.state.value)
            assertEquals(listOf("invoices/i1/collect-summary"), paths(backend).filter { it.startsWith("invoices") })
            assertEquals(1, ready.dues.size)
            assertNotNull(ready.dues.single().upi)
        }

    @Test
    fun a_zero_balance_gives_no_dues_and_closes_the_card() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson(0)) })
            val h = holder(backend, assistant, "i1")
            until { h.state.value is DeskPayState.Ready }
            assertEquals(emptyList(), assertIs<DeskPayState.Ready>(h.state.value).dues)
            assertEquals(false, h.cardOpen.value)
        }

    @Test
    fun an_assistant_without_an_invoice_is_not_allowed() =
        runTest {
            val h = holder(FakeBackend(), assistant, null)
            assertEquals(DeskPayState.NotAllowed, h.state.value)
        }

    @Test
    fun a_409_refetches_by_collect_summary_for_an_assistant() =
        runTest {
            val backend = FakeBackend()
            backend.on(summary, { json(summaryJson(5000)) })
            backend.on(payments, { apiError(HttpStatusCode.Conflict, "conflict") })
            val h = holder(backend, assistant, "i1")
            until { h.state.value is DeskPayState.Ready }
            val before = backend.requests.size
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            val after = paths(backend).drop(before)
            assertEquals(
                listOf("invoices/i1/collect-summary", "payments", "invoices/i1/collect-summary"),
                after.take(3),
            )
            assertEquals(false, after.any { it == "invoices/i1" || it.startsWith("invoices?") })
        }

    @Test
    fun finance_without_payments_collect_uses_the_invoice_read() =
        runTest {
            val backend = FakeBackend()
            backend.on(list, { json(items(invoiceJson("i1", "v1", 5000, 5000))) })
            backend.on(invoice, { json(invoiceJson("i1", "v1", 5000, 5000)) })
            backend.on(payments, { apiError(HttpStatusCode.Conflict, "conflict") })
            val h = holder(backend, finance, null)
            until { h.state.value is DeskPayState.Ready }
            val before = backend.requests.size
            h.record("i1", 5000, PayMethod.Cash, null)
            until { h.outcome.value.let { it !is DeskPayOutcome.Idle && it !is DeskPayOutcome.Sending } }
            val after = paths(backend).drop(before)
            assertEquals(false, after.any { it.endsWith("collect-summary") })
            assertEquals("invoices/i1", after.first())
        }
}
