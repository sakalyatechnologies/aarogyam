package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class UpiLinkHolderTest {
    private val route = "$SUNRISE/api/v1/invoices/i1/upi-link"
    private val bill = DueBill("i1", "INV-1", 125000)

    @Test
    fun the_button_needs_billing_write_an_issued_bill_and_a_balance() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val writer =
                UpiLinkHolder(
                    openClinic(backend, graph, this, listOf("billing.read", "billing.write")),
                    backgroundScope,
                )
            assertTrue(writer.canSend(bill))
            assertFalse(writer.canSend(bill.copy(draft = true)))
            assertFalse(writer.canSend(bill.copy(balancePaise = 0)))
        }

    @Test
    fun a_reader_cannot_send_and_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val reader = UpiLinkHolder(openClinic(backend, graph, this, listOf("billing.read")), backgroundScope)
            assertFalse(reader.canSend(bill))
            reader.send("i1")
            assertEquals(0, backend.count(route))
        }

    @Test
    fun the_link_comes_back_as_share_text() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        """{"uri":"upi://pay?pa=c@bank&am=1250.00","qr_data":"upi://pay?pa=c@bank&am=1250.00","upi_id":"c@bank",
                        "payee_name":"Sunrise","invoice_number":"INV-1","amount_paise":125000}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder =
                UpiLinkHolder(
                    openClinic(backend, graph, this, listOf("billing.read", "billing.write")),
                    backgroundScope,
                )
            holder.send("i1")
            val ready =
                assertIs<UpiLinkState.Ready>(
                    holder.state.first {
                        it is UpiLinkState.Ready ||
                            it is UpiLinkState.Failed
                    },
                )
            assertEquals("Pay Rs 1250 to Sunrise for bill INV-1: upi://pay?pa=c@bank&am=1250.00", ready.share.text)
            holder.dismiss()
            assertEquals(UpiLinkState.Idle, holder.state.value)
        }

    @Test
    fun no_upi_id_in_settings_is_a_failure_not_a_link() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.Conflict, "no_upi_id") })
            val graph = testGraph(backend, backgroundScope)
            val holder =
                UpiLinkHolder(
                    openClinic(backend, graph, this, listOf("billing.read", "billing.write")),
                    backgroundScope,
                )
            holder.send("i1")
            assertIs<UpiLinkState.Failed>(holder.state.first { it is UpiLinkState.Ready || it is UpiLinkState.Failed })
        }
}
