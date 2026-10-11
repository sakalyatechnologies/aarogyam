package com.aarogyam.staff.history

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.http.OfflineException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

internal fun visitJson(
    id: String,
    startedAt: String,
    complaint: String? = "Toothache",
) = """{"id":"$id","number":"V-$id","patient_id":"p1","clinician":{"id":"m1","name":"Dr. Patil"},
    "status":"closed","started_at":"$startedAt","chief_complaint":${complaint?.let { "\"$it\"" }}}"""

internal fun rxJson(
    id: String,
    encounter: String?,
    status: String = "issued",
) = """{"id":"$id","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"$status","language":"en-IN",
    "created_at":"2026-10-01T00:00:00Z","encounter_id":${encounter?.let { "\"$it\"" }},"number":"RX-$id","alerts":[],
    "items":[{"drug_name":"Amoxicillin","strength":"500 mg","dose":"1","frequency":"1-0-1","duration_days":5,"timing":"after food"}]}"""

internal fun invoiceJson(
    id: String,
    encounter: String?,
    total: Long,
    paid: Long,
    status: String = "issued",
) = """{"id":"$id","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"$status",
    "subtotal_paise":$total,"discount_paise":0,"taxable_paise":$total,"cgst_paise":0,"sgst_paise":0,"igst_paise":0,
    "tax_paise":0,"round_off_paise":0,"total_paise":$total,"paid_paise":$paid,"balance_paise":${total - paid},
    "methods":[],"created_at":"2026-10-01T00:00:00Z","items":[],"number":"INV-$id","encounter_id":${encounter?.let {
    "\"$it\""
}},
    "payment_state":"${if (paid >= total) "paid" else "partial"}"}"""

internal fun items(vararg rows: String) = """{"items":${rows.joinToString(",", "[", "]")}}"""

class VisitHistoryStateHolderTest {
    private val base = "$SUNRISE/api/v1/patients/p1"
    private val invoices = "$SUNRISE/api/v1/invoices"
    private val all = listOf("patients.read", "clinical.read", "billing.read")

    private fun FakeBackend.serve() {
        on(
            "$base/visits",
            {
                json(
                    items(
                        visitJson("v1", "2026-08-01T04:30:00Z"),
                        visitJson("v3", "2026-10-01T04:30:00Z", complaint = null),
                        visitJson("v2", "2026-09-01T04:30:00Z"),
                    ),
                )
            },
        )
        on("$base/prescriptions", { json(items(rxJson("r1", "v3"), rxJson("r2", "v2", "cancelled"))) })
        on(invoices, {
            json(
                items(
                    invoiceJson("i3", "v3", 5000, 5000),
                    invoiceJson("i2", "v2", 8000, 2000),
                    invoiceJson("i9", null, 100, 0),
                ),
            )
        })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = all,
    ): VisitHistoryStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.visitHistory(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    private suspend fun VisitHistoryStateHolder.loaded() =
        state.first {
            it is VisitHistoryState.Loaded
        } as VisitHistoryState.Loaded

    @Test
    fun visits_come_newest_first_with_rx_and_bill_joined_by_encounter() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val loaded = holder(backend).loaded()
            assertEquals(listOf("v3", "v2", "v1"), loaded.rows.map { it.id })
            val (newest, middle, oldest) = loaded.rows
            assertTrue(newest.hasRx)
            assertEquals(BillState.Paid, newest.bill)
            assertNull(newest.title)
            assertEquals("Dr. Patil", newest.clinician)
            assertEquals(false, middle.hasRx)
            assertEquals(BillState.Due, middle.bill)
            assertEquals(false, oldest.hasRx)
            assertEquals(BillState.None, oldest.bill)
            assertNull(oldest.hasNotes)
            assertNull(oldest.hasPhotos)
        }

    @Test
    fun a_screen_is_three_requests() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            holder(backend).loaded()
            assertEquals(
                3,
                backend.requests.count {
                    it.url.encodedPath.let { p ->
                        "/visits" in p ||
                            "prescriptions" in p ||
                            "invoices" in p
                    }
                },
            )
        }

    @Test
    fun an_assistant_gets_no_bills_and_no_money_request() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val loaded = holder(backend, listOf("patients.read", "clinical.read")).loaded()
            assertEquals(false, loaded.moneyVisible)
            assertTrue(loaded.rows.all { it.bill == BillState.None })
            assertEquals(0, backend.count(invoices))
        }

    @Test
    fun without_patients_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("clinical.read"))
            assertEquals(VisitHistoryState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count("$base/visits"))
        }

    @Test
    fun offline_fails_the_screen_as_offline() =
        runTest {
            val backend = FakeBackend()
            backend.on("$base/visits", { throw OfflineException() })
            backend.on("$base/prescriptions", { json(items()) })
            backend.on(invoices, { json(items()) })
            val failed = holder(backend).state.first { it is VisitHistoryState.Failed } as VisitHistoryState.Failed
            assertEquals(ScreenError.Offline, failed.error)
        }
}
