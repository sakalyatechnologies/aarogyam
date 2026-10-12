package com.aarogyam.staff.patients

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PatientOverviewStateHolderTest {
    private val base = "$SUNRISE/api/v1/patients/p1"
    private val invoicesRoute = "$SUNRISE/api/v1/invoices"
    private val all = listOf("patients.read", "clinical.read", "billing.read")
    private val assistant = listOf("patients.read", "clinical.read")

    private fun entry(
        id: String,
        tooth: Int,
        finding: String,
        at: String = "2026-09-20T04:30:00Z",
        procedure: String? = null,
    ) =
        """{"id":"$id","tooth":$tooth,"finding":"$finding","status":"current","effective_at":"$at","surface":null,"note":null,
        "procedure":${procedure?.let {
            """{"id":"p","kind":"procedure","label":"$it","own":false,"retired":false}"""
        }}}"""

    private fun chart(vararg e: String) = """{"current":[${e.joinToString(",")}],"history":[],"terms":[]}"""

    private fun invoice(
        id: String,
        status: String,
        total: Long,
        paid: Long,
    ) = """{"id":"$id","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"$status",
        "subtotal_paise":$total,"discount_paise":0,"taxable_paise":$total,"cgst_paise":0,"sgst_paise":0,"igst_paise":0,
        "tax_paise":0,"round_off_paise":0,"total_paise":$total,"paid_paise":$paid,"balance_paise":${total - paid},
        "methods":[],"created_at":"2026-10-01T00:00:00Z","items":[]}"""

    private fun file(
        id: String,
        kind: String,
    ) = """{"id":"$id","kind":"$kind","mime_type":"image/jpeg","size_bytes":1,"sha256":"${"0".repeat(64)}",
        "label":null,"tooth":46,"created_at":"2026-10-02T20:00:00Z"}"""

    private val flags =
        """{"allergy_count":1,"severe_allergy":true,"condition_count":0,"details_hidden":false,"allergies_reviewed":"has_allergies",
           "allergies":[{"id":"a1","substance":"Penicillin","severity":"severe","confirmed":true,"reaction":"Rash","status":"active",
             "source":"staff","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}],"conditions":[]}"""
    private val noFlags =
        """{"allergy_count":0,"severe_allergy":false,"condition_count":0,"details_hidden":false,"allergies_reviewed":"unknown",
           "allergies":[],"conditions":[]}"""
    private val visit =
        """{"id":"v1","number":"V-318","patient_id":"p1","clinician":{"id":"m1","name":"Dr. Patil"},
           "status":"closed","started_at":"2026-09-20T04:30:00Z","chief_complaint":"Toothache"}"""

    private fun FakeBackend.serve(
        chart: String = chart(entry("e1", 46, "root_canal"), entry("e2", 36, "caries"), entry("e3", 21, "watch")),
        flags: String = this@PatientOverviewStateHolderTest.flags,
        visits: List<String> = listOf(visit),
        files: List<String> = listOf(file("f1", "xray"), file("f2", "document"), file("f3", "photo")),
        invoices: List<String> = listOf(invoice("1", "issued", 1000000, 400000), invoice("2", "void", 500000, 0)),
    ) {
        on("$base/dental-chart", { json(chart) })
        on("$base/clinical-flags", { json(flags) })
        on("$base/visits", { json("""{"items":[${visits.joinToString(",")}]}""") })
        on("$base/attachments", { json("""{"items":[${files.joinToString(",")}]}""") })
        on(invoicesRoute, { json("""{"items":[${invoices.joinToString(",")}]}""") })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = all,
    ): PatientOverviewStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return PatientOverviewStateHolder(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    private suspend fun PatientOverviewStateHolder.loaded(done: (OverviewState.Loaded) -> Boolean = { true }) =
        state.first { it is OverviewState.Loaded && done(it) } as OverviewState.Loaded

    @Test
    fun findings_map_to_the_four_statuses_one_row_per_tooth_and_day() =
        runTest {
            val backend = FakeBackend()
            backend.serve(
                chart =
                    chart(
                        entry("e1", 46, "root_canal", procedure = "Root canal"),
                        entry("e2", 36, "caries"),
                        entry("e3", 21, "watch"),
                        entry("e4", 11, "crown", at = "2026-09-01T04:30:00Z"),
                        entry("e5", 11, "filled", at = "2026-09-01T05:00:00Z"),
                        entry("e6", 16, "root_canal"),
                        entry("e7", 16, "crown", at = "2026-08-01T04:30:00Z"),
                        entry("e8", 12, "sound"),
                    ),
            )
            val rows = holder(backend).loaded().treatments
            val status = rows.associate { (it.tooth to it.date.date.toString()) to it.status }
            assertEquals(TxStatus.InProgress, status[46 to "2026-09-20"])
            assertEquals(TxStatus.Planned, status[36 to "2026-09-20"])
            assertEquals(TxStatus.Watch, status[21 to "2026-09-20"])
            assertEquals(TxStatus.Done, status[11 to "2026-09-01"])
            assertEquals(TxStatus.Done, status[16 to "2026-09-20"]) // crowned tooth: root canal is finished
            assertEquals(1, rows.count { it.tooth == 11 }) // crown and filling on one day: one row
            assertEquals(null, status[12 to "2026-09-20"]) // sound is not a treatment
            assertEquals("Root canal", rows.first { it.tooth == 46 }.procedure)
            assertEquals(Finding.RootCanal, rows.first { it.tooth == 46 }.finding)
            assertEquals(listOf(16, 21, 36), rows.take(3).map { it.tooth }) // newest day first, then by tooth
        }

    @Test
    fun the_other_parts_are_read_from_the_record() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val state = holder(backend).loaded()
            assertEquals(
                "Penicillin",
                state.alerts.allergies
                    .single()
                    .substance,
            )
            assertEquals(
                Severity.Severe,
                state.alerts.allergies
                    .single()
                    .severity,
            )
            assertEquals("V-318", state.lastVisit?.number)
            assertEquals("Dr. Patil", state.lastVisit?.clinician)
            assertEquals(listOf(MediaKind.Xray, MediaKind.Photo), state.media.map { it.kind })
        }

    @Test
    fun the_money_summary_starts_hidden_and_toggles_without_a_request() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend)
            val first = holder.loaded()
            assertFalse(first.moneyShown)
            assertEquals(MoneySummary(visits = 1, paidPaise = 400000, remainingPaise = 600000), first.money)
            holder.toggleMoney()
            assertTrue(holder.loaded { it.moneyShown }.moneyShown)
            holder.toggleMoney()
            assertFalse(holder.loaded { !it.moneyShown }.moneyShown)
            assertEquals(1, backend.count(invoicesRoute))
        }

    @Test
    fun a_new_holder_starts_hidden_again() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val one = holder(backend)
            one.loaded()
            one.toggleMoney()
            assertFalse(holder(backend).loaded().moneyShown)
        }

    @Test
    fun the_assistant_gets_no_money_and_no_bills_are_requested() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend, assistant)
            assertNull(holder.loaded().money)
            holder.toggleMoney()
            assertFalse(holder.loaded().moneyShown)
            assertEquals(0, backend.count(invoicesRoute))
        }

    @Test
    fun empty_states() =
        runTest {
            val backend = FakeBackend()
            backend.serve(
                chart = chart(),
                flags = noFlags,
                visits = emptyList(),
                files = emptyList(),
                invoices = emptyList(),
            )
            val state = holder(backend).loaded()
            assertTrue(state.treatments.isEmpty() && state.media.isEmpty())
            assertNull(state.lastVisit)
            assertFalse(state.alerts.hasFlags)
            assertEquals(MoneySummary(0, 0, 0), state.money)
        }

    @Test
    fun without_clinical_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend, listOf("patients.read"))
            assertEquals(OverviewState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count("$base/dental-chart"))
        }

    @Test
    fun a_failure_fails_the_screen_and_offline_is_its_own_error() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on("$base/visits", { apiError(HttpStatusCode.InternalServerError, "boom") })
            val failed = holder(backend).state.first { it is OverviewState.Failed }
            assertIs<OverviewState.Failed>(failed)
            assertEquals(ScreenError.Server, failed.error)
        }
}
