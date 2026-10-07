package com.aarogyam.staff.billing

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BillingStateHolderTest {
    private val invoices = "$SUNRISE/api/v1/invoices"
    private val payments = "$SUNRISE/api/v1/payments"

    private fun invoice(
        id: String,
        status: String,
        total: Long,
        paid: Long,
        state: String? = null,
        number: String? = "SC/26-27/0003$id",
    ) = """{"id":"$id","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"$status",
        "subtotal_paise":$total,"discount_paise":0,"taxable_paise":$total,"cgst_paise":0,"sgst_paise":0,"igst_paise":0,
        "tax_paise":0,"round_off_paise":0,"total_paise":$total,"paid_paise":$paid,"balance_paise":${total - paid},
        "methods":[],"created_at":"2026-10-01T00:00:00Z","items":[],
        "number":${number?.let { "\"$it\"" }},"payment_state":${state?.let { "\"$it\"" }},
        "issued_at":"2026-10-03T05:00:00Z"}"""

    private val bills =
        """{"items":[${invoice(
            "10",
            "issued",
            850000,
            0,
            "unpaid",
        )},${invoice("11", "issued", 1190000, 400000, "partial")},
            ${invoice("12", "issued", 1200000, 1200000, "paid")},${invoice("13", "void", 500000, 0)},
            ${invoice("14", "draft", 100000, 0, number = null)}]}"""

    private fun payment(
        amount: Long,
        number: String = "RC/26-27/000042",
    ) = """{"id":"pay1","number":"$number","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},
        "received_at":"2026-10-06T05:00:00Z","amount_paise":$amount,"method":"upi","status":"received",
        "allocated_paise":$amount,"unallocated_paise":0,"allocations":[{"invoice_id":"10","amount_paise":$amount}]}"""

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("billing.read", "billing.write"),
    ): BillingStateHolder {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.billing(clinic, "p1", backgroundScope)
    }

    private suspend fun BillingStateHolder.loaded(): BillingState.Loaded =
        state.first {
            it is BillingState.Loaded && !it.refreshing && it.form?.submitting != true
        } as BillingState.Loaded

    private fun FakeBackend.postKeys() =
        requests
            .toList()
            .filter {
                it.method == HttpMethod.Post && it.url.encodedPath.endsWith("/payments")
            }.map { it.headers["Idempotency-Key"] }

    @Test
    fun it_lists_the_bills_without_drafts_and_totals_the_balance() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            val view = holder(backend).loaded().view
            assertEquals(1, backend.count(invoices))
            assertEquals(
                "p1",
                backend.requests
                    .first { it.url.encodedPath.endsWith("/invoices") }
                    .url.parameters["patient_id"],
            )
            assertEquals(
                listOf(BillStatus.Issued, BillStatus.PartPaid, BillStatus.Paid, BillStatus.Void),
                view.bills.map { it.status },
            )
            assertEquals(850000L + 790000L, view.balancePaise)
            assertEquals(LocalDate(2026, 10, 3), view.bills.first().issuedOn)
            assertEquals(listOf(true, true, false, false), view.bills.map { it.canRecordPayment })
        }

    @Test
    fun without_billing_read_the_tab_is_hidden_and_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            val billing = holder(backend, listOf("patients.read"))
            assertEquals(BillingState.Hidden, billing.state.value)
            billing.refresh()
            assertEquals(0, backend.count(invoices))
        }

    @Test
    fun without_billing_write_no_bill_takes_a_payment() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            val billing = holder(backend, listOf("billing.read"))
            val loaded = billing.loaded()
            assertTrue(loaded.view.bills.none { it.canRecordPayment })
            billing.startPayment("10")
            assertNull((billing.state.value as BillingState.Loaded).form)
        }

    @Test
    fun a_failed_load_fails_the_tab_and_a_retry_loads() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { apiError(HttpStatusCode.NotImplemented, "internal") }, { json(bills) })
            val billing = holder(backend)
            assertIs<BillingState.Failed>(billing.state.first { it is BillingState.Failed })
            billing.refresh()
            assertEquals(
                4,
                billing
                    .loaded()
                    .view.bills.size,
            )
        }

    @Test
    fun a_payment_starts_at_the_current_balance_and_shows_the_updated_balance() =
        runTest {
            val backend = FakeBackend()
            val after = """{"items":[${invoice("10", "issued", 850000, 850000, "paid")}]}"""
            backend.on(invoices, { json(bills) }, { json(after) })
            backend.on(payments, { json(payment(850000), HttpStatusCode.Created) })
            val billing = holder(backend)
            billing.loaded()
            billing.startPayment("11")
            assertEquals("7900", billing.loaded().form?.amountText)
            billing.startPayment("10")
            billing.setMethod(PayMethod.Upi)
            billing.setReference(" UTR1 ")
            assertEquals("8500", billing.loaded().form?.amountText)
            billing.submitPayment()
            val done =
                billing.state.first {
                    it is BillingState.Loaded && it.form == null && !it.refreshing
                } as BillingState.Loaded
            assertEquals("RC/26-27/000042", done.receipt)
            assertEquals(0L, done.view.balancePaise)
            val post =
                backend.requests.single {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath.endsWith("/payments")
                }
            val body = (post.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
            assertTrue("\"method\":\"upi\"" in body && "\"amount_paise\":850000" in body && "UTR1" in body, body)
            assertTrue("\"invoice_id\":\"10\"" in body, body)
            assertEquals(2, backend.count(invoices))
        }

    @Test
    fun an_amount_of_zero_or_junk_is_refused_before_any_request() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            val billing = holder(backend)
            billing.loaded()
            billing.startPayment("10")
            for (text in listOf("0", "", "abc", "12.345", "-5")) {
                billing.setAmount(text)
                billing.submitPayment()
                assertTrue(billing.loaded().form?.amountInvalid == true, text)
            }
            assertEquals(0, backend.count(payments))
        }

    @Test
    fun a_failed_payment_keeps_the_sheet_and_a_retry_reuses_the_idempotency_key() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            backend.on(
                payments,
                { apiError(HttpStatusCode.NotImplemented, "internal") },
                { json(payment(850000), HttpStatusCode.OK) },
            )
            val billing = holder(backend)
            billing.loaded()
            billing.startPayment("10")
            billing.submitPayment()
            val failed =
                billing.state.first {
                    it is BillingState.Loaded && it.form?.error != null
                } as BillingState.Loaded
            assertEquals(ScreenError.Server, failed.form?.error)
            assertEquals(false, failed.form?.submitting)
            billing.submitPayment()
            billing.state.first { it is BillingState.Loaded && it.receipt != null }
            val keys = backend.postKeys()
            assertEquals(2, keys.size)
            assertEquals(keys[0], keys[1])
            assertTrue(!keys[0].isNullOrBlank())
        }

    @Test
    fun editing_the_payment_after_a_failure_is_a_new_submission() =
        runTest {
            val backend = FakeBackend()
            backend.on(invoices, { json(bills) })
            backend.on(payments, {
                apiError(HttpStatusCode.Conflict, "conflict")
            }, { json(payment(100000), HttpStatusCode.Created) })
            val billing = holder(backend)
            billing.loaded()
            billing.startPayment("10")
            billing.submitPayment()
            billing.state.first { it is BillingState.Loaded && it.form?.error != null }
            billing.setAmount("1000")
            billing.submitPayment()
            billing.state.first { it is BillingState.Loaded && it.receipt != null }
            val keys = backend.postKeys()
            assertNotEquals(keys[0], keys[1])
        }

    @Test
    fun amounts_round_trip_through_rupee_text() {
        assertEquals("1250", rupeesText(125000))
        assertEquals("1250.5", rupeesText(125050))
        assertEquals("0.05", rupeesText(5))
        assertEquals(5L, parseRupees("0.05"))
        assertEquals(125050L, parseRupees("1250.5"))
        assertNull(parseRupees("0.00"))
    }
}
