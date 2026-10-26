package com.aarogyam.staff.history

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.http.OfflineException
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun note(
    id: String,
    status: String,
    s: String? = null,
    o: String? = null,
    a: String? = null,
    p: String? = null,
) =
    """{"id":"$id","visit_id":"v1","kind":"visit","source":"staff","status":"$status","author":{"id":"m1","name":"Dr. Patil"},
    "created_at":"2026-10-01T04:30:00Z","updated_at":"2026-10-01T04:30:00Z","row_version":1,"addenda":[],
    "sections":{"subjective":${q(s)},"objective":${q(o)},"assessment":${q(a)},"plan":${q(p)}}}"""

private fun q(text: String?) = text?.let { "\"$it\"" }

private fun procedure(
    id: String,
    name: String,
    tooth: Int?,
    price: Long?,
    status: String = "done",
) =
    """{"id":"$id","visit_id":"v1","clinician":{"id":"m1","name":"Dr. Patil"},"name":"$name","surfaces":[],"status":"$status",
    "created_at":"2026-10-01T04:30:00Z","tooth":$tooth,"price_paise":$price}"""

private val photo =
    """{"id":"f1","kind":"photo","mime_type":"image/jpeg","size_bytes":10,"sha256":"${"0".repeat(
        64,
    )}","label":"OPG","tooth":36,
    "created_at":"2026-10-01T04:40:00Z"}"""

class VisitDetailStateHolderTest {
    private val visit = "$SUNRISE/api/v1/visits/v1"
    private val rx = "$SUNRISE/api/v1/patients/p1/prescriptions"
    private val invoices = "$SUNRISE/api/v1/invoices"
    private val all = listOf("patients.read", "clinical.read", "billing.read")

    private fun FakeBackend.serve(
        prescriptions: String = items(rxJson("r0", "other"), rxJson("r1", "v1")),
        bills: String = items(invoiceJson("i0", "other", 100, 0), invoiceJson("i1", "v1", 9000, 4000)),
    ) {
        on(
            visit,
            {
                json(
                    """{"visit":${visitJson("v1", "2026-10-01T04:30:00Z")},
                    "notes":[${note("n1", "signed", s = "Pain on biting", p = "Review in a week")},
                      ${note(
                        "n2",
                        "entered_in_error",
                        s = "wrong chart",
                    )},${note("n3", "draft", o = "Deep caries 36", a = "Pulpitis")}],
                    "procedures":[${procedure(
                        "c1",
                        "Root canal",
                        36,
                        800000,
                    )},${procedure("c2", "Scaling", null, null)},
                      ${procedure("c3", "Mistake", 11, 100, "entered_in_error")}],
                    "chart_entries":[],"observations":[],"attachments":[$photo]}""",
                )
            },
        )
        on(rx, { json(prescriptions) })
        on(invoices, { json(bills) })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = all,
    ): VisitDetailStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.visitDetail(openClinic(backend, graph, this, permissions), "v1", "p1", backgroundScope)
    }

    private suspend fun VisitDetailStateHolder.view() =
        (
            state.first {
                it is VisitDetailState.Loaded
            } as VisitDetailState.Loaded
        ).view

    @Test
    fun the_detail_groups_notes_and_joins_the_rx_and_bill_by_encounter() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val view = holder(backend).view()
            assertEquals(listOf("Pain on biting"), view.notes.subjective)
            assertEquals(listOf("Deep caries 36"), view.notes.objective)
            assertEquals(listOf("Pulpitis"), view.notes.assessment)
            assertEquals(listOf("Review in a week"), view.notes.plan)
            assertEquals("Dr. Patil", view.notes.signedBy)
            assertEquals(listOf("Root canal", "Scaling"), view.procedures.map { it.name })
            assertEquals(36, view.procedures.first().tooth)
            assertEquals(800000L, view.procedures.first().feePaise)
            assertEquals("r1", view.rx?.id)
            assertEquals(
                "Amoxicillin",
                view.rx
                    ?.items
                    ?.single()
                    ?.name,
            )
            assertEquals(listOf("OPG"), view.files.map { it.label })
            val bill = view.bill
            assertEquals(Triple(9000L, 4000L, 5000L), Triple(bill?.totalPaise, bill?.paidPaise, bill?.balancePaise))
            assertEquals(1, backend.count(visit))
            assertEquals(1, backend.count(rx))
            assertEquals(1, backend.count(invoices))
        }

    @Test
    fun a_visit_without_a_prescription_or_bill_has_neither() =
        runTest {
            val backend = FakeBackend()
            backend.serve(
                items(rxJson("r0", "other")),
                items(invoiceJson("i0", null, 100, 0), invoiceJson("i2", "v1", 500, 0, "void")),
            )
            val view = holder(backend).view()
            assertNull(view.rx)
            assertNull(view.bill)
            assertTrue(view.moneyVisible)
        }

    @Test
    fun an_assistant_sees_no_fees_or_bill_and_no_invoice_request() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val view = holder(backend, listOf("patients.read", "clinical.read")).view()
            assertEquals(false, view.moneyVisible)
            assertNull(view.bill)
            assertTrue(view.procedures.all { it.feePaise == null })
            assertEquals(0, backend.count(invoices))
        }

    @Test
    fun without_patients_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("billing.read"))
            assertEquals(VisitDetailState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(visit))
        }

    @Test
    fun a_colleagues_visit_is_not_found() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(visit, { apiError(HttpStatusCode.NotFound, "not_found") })
            val failed = holder(backend).state.first { it is VisitDetailState.Failed } as VisitDetailState.Failed
            assertEquals(ScreenError.NotFound, failed.error)
        }

    @Test
    fun offline_fails_the_screen_as_offline() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(visit, { throw OfflineException() })
            val failed = holder(backend).state.first { it is VisitDetailState.Failed } as VisitDetailState.Failed
            assertEquals(ScreenError.Offline, failed.error)
        }
}
