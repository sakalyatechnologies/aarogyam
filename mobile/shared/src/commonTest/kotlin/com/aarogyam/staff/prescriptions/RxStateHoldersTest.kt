package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Severity
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val STAMP = """"created_at":"2026-10-01T05:00:00Z""""

private fun rx(
    id: String,
    status: String,
    number: String? = null,
    extra: String = "",
): String =
    """{"id":"$id","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"$status",
       "language":"en-IN",$STAMP,"number":${number?.let { "\"$it\"" }},"alerts":[],$extra
       "items":[{"drug_name":"AMOXICILLIN","strength":"500 mg","dose":"1 capsule","frequency":"1-0-1","duration_days":5}]}"""

private val amoxicillin =
    """{"id":"d1","generic_name":"Amoxicillin","brand_name":"Mox","strength":"500 mg","form":"capsule",
       "default_dose":"1 capsule","default_frequency":"1-0-1","default_duration_days":7,"default_timing":"after_food"}"""
private val paracetamol =
    """{"id":"d2","generic_name":"Paracetamol","strength":"650 mg","form":"tablet",
       "default_dose":"1 tablet","default_frequency":"SOS"}"""

private val penicillin = AllergyView("Amoxicillin", Severity.Severe, "Rash")

class RxListStateHolderTest {
    private val route = "$SUNRISE/api/v1/patients/p1/prescriptions"

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "clinical.read", "prescriptions.issue"),
    ): RxListStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.rxList(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    @Test
    fun lists_newest_first_with_status_and_the_clinic_time() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        """{"items":[${rx(
                            "r2",
                            "issued",
                            "RX-2",
                            """"issued_at":"2026-10-02T20:00:00Z","override_reason":"tolerated",""",
                        )},
                        ${rx("r1", "draft")}]}""",
                    )
                },
            )
            val loaded = holder(backend).state.first { it is RxListState.Loaded } as RxListState.Loaded
            assertEquals(listOf("r2", "r1"), loaded.items.map { it.id })
            val issued = loaded.items.first()
            assertEquals(RxStatus.Issued, issued.status)
            assertEquals("RX-2", issued.number)
            assertTrue(issued.allergyOverridden)
            assertEquals("2026-10-03", issued.at?.date.toString(), "Asia/Kolkata is ahead of UTC")
            assertEquals("AMOXICILLIN 500 mg", issued.medicines.single().name)
            assertEquals(RxStatus.Draft, loaded.items.last().status)
            assertTrue(loaded.canIssue)
            assertEquals(1, backend.count(route))
        }

    @Test
    fun a_role_without_clinical_read_requests_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("patients.read"))
            assertEquals(RxListState.NotAllowed, holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count(route))
        }

    @Test
    fun a_failure_is_shown_and_a_refresh_failure_keeps_the_list() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.InternalServerError, "internal") })
            val holder = holder(backend)
            assertEquals(
                ScreenError.Server,
                assertIs<RxListState.Failed>(holder.state.first { it is RxListState.Failed }).error,
            )
            backend.on(route, { json("""{"items":[${rx("r1", "issued", "RX-1")}]}""") })
            holder.refresh()
            holder.state.first { it is RxListState.Loaded }
            backend.on(route, { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") })
            holder.refresh()
            val kept = holder.state.first { it is RxListState.Loaded && it.error != null } as RxListState.Loaded
            assertEquals(1, kept.items.size)
        }
}

class RxSheetStateHolderTest {
    private val patient = "$SUNRISE/api/v1/patients/p1/prescriptions"
    private val issue = "$SUNRISE/api/v1/prescriptions/r1/issue"
    private val share = "$SUNRISE/api/v1/prescriptions/r1/share"

    private fun FakeBackend.serve() {
        on("$SUNRISE/api/v1/drugs/search", { json("""{"items":[$amoxicillin,$paracetamol]}""") })
        on(patient, { json(rx("r1", "draft")) })
        on(issue, { json(rx("r1", "issued", "RX-412")) })
        on(share, {
            json(
                """{"id":"s1","token":"tok123","pin":"482913","expires_at":"2026-10-08T05:00:00Z"}""",
                HttpStatusCode.Created,
            )
        })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        allergies: List<AllergyView> = emptyList(),
        permissions: List<String> = listOf("patients.read", "clinical.read", "prescriptions.issue"),
    ): RxSheetStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.rxSheet(openClinic(backend, graph, this, permissions), "p1", allergies, backgroundScope)
    }

    private suspend fun RxSheetStateHolder.pick(query: String = "amox"): DrugView {
        search(query)
        return state.first { it.results.isNotEmpty() }.results.first()
    }

    @Test
    fun picking_a_drug_uses_the_catalogue_presets_and_the_search_goes_in_the_body() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            val sheet = holder(backend)
            sheet.add(sheet.pick())
            val line =
                sheet.state.value.lines
                    .single()
            assertEquals(
                listOf("1 capsule", "1-0-1", 7, "after_food"),
                listOf(line.dose, line.frequency, line.durationDays, line.timing),
            )
            sheet.setFrequency(line.key, RxPresets.frequencies[0])
            sheet.setDuration(line.key, 10)
            sheet.setDose(line.key, RxPresets.doses[1])
            assertEquals(
                listOf("2 tablets", "1-0-0", 10),
                sheet.state.value.lines.single().let {
                    listOf(it.dose, it.frequency, it.durationDays)
                },
            )
            val search = backend.requests.first { it.url.encodedPath == "/api/v1/drugs/search" }
            assertEquals(HttpMethod.Post, search.method)
            assertFalse(search.url.toString().contains("amox"))
            assertEquals("", sheet.state.value.query)
        }

    @Test
    fun a_recorded_allergy_warns_before_issuing_and_a_reason_is_needed() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            val sheet = holder(backend, listOf(penicillin))
            sheet.add(sheet.pick())
            val state = sheet.state.value
            assertEquals("Amoxicillin", state.warnings.single().substance)
            assertEquals(Severity.Severe, state.warnings.single().severity)
            assertTrue(state.needsOverride)
            assertFalse(state.canIssue)
            sheet.issue()
            assertEquals(0, backend.count(patient), "nothing is sent without a reason")
            sheet.setOverrideReason("ab")
            assertFalse(sheet.state.value.canIssue)
            sheet.setOverrideReason("Tolerated last year")
            sheet.issue()
            sheet.state.first { it.phase == RxPhase.Issued }
            val body =
                backend.requests
                    .last { it.url.encodedPath.endsWith("/issue") }
                    .body
                    .toString()
            assertTrue(body.isNotEmpty())
            sheet.remove(
                sheet.state.value.lines
                    .single()
                    .key,
            )
            assertTrue(
                sheet.state.value.lines
                    .isNotEmpty(),
                "an issued prescription is frozen",
            )
        }

    @Test
    fun issuing_creates_one_draft_issues_it_and_makes_the_link_with_its_pin() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            val sheet = holder(backend)
            sheet.add(sheet.pick())
            assertTrue(sheet.state.value.canIssue)
            sheet.issue()
            val done = sheet.state.first { it.share is ShareState.Ready }
            assertEquals("RX-412", done.issued?.number)
            assertEquals("Sunrise Dental", done.issued?.clinicName)
            val link = assertIs<ShareState.Ready>(done.share).link
            assertEquals("482913", link.pin)
            assertTrue(link.url.endsWith("/shared/tok123"), link.url)
            assertFalse(link.url.contains("482913"), "the PIN never travels in the link")
            assertEquals("2026-10-08", link.expiresAt?.date.toString())
            listOf(patient, issue, share).forEach { assertEquals(1, backend.count(it), it) }
            val create = backend.requests.first { it.url.encodedPath.endsWith("/prescriptions") }
            assertEquals(HttpMethod.Post, create.method)
            sheet.issue()
            assertEquals(1, backend.count(issue), "a second tap does nothing")
        }

    @Test
    fun the_clinics_own_allergy_stop_asks_for_a_reason_and_resumes_the_same_draft() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            backend.on(
                issue,
                {
                    json(
                        """{"code":"allergy_alerts","alerts":[{"kind":"allergy","severity":"serious","message":"x"}]}""",
                        HttpStatusCode.Conflict,
                    )
                },
                { json(rx("r1", "issued", "RX-412", """"override_reason":"fine",""")) },
            )
            val sheet = holder(backend)
            sheet.add(sheet.pick())
            sheet.issue()
            val blocked = sheet.state.first { it.serverAlert }
            assertEquals(RxPhase.Composing, blocked.phase)
            assertTrue(blocked.needsOverride)
            assertFalse(blocked.canIssue)
            sheet.setOverrideReason("Tolerated last year")
            sheet.issue()
            sheet.state.first { it.phase == RxPhase.Issued }
            assertEquals(1, backend.count(patient), "the draft is reused")
            assertEquals(2, backend.count(issue))
        }

    @Test
    fun an_error_keeps_the_sheet_open_and_a_retry_resumes() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            backend.on(
                issue,
                { apiError(HttpStatusCode.InternalServerError, "internal") },
                { json(rx("r1", "issued", "RX-412")) },
            )
            val sheet = holder(backend)
            sheet.add(sheet.pick())
            sheet.issue()
            val failed = sheet.state.first { it.error != null }
            assertEquals(ScreenError.Server, failed.error)
            assertEquals(RxPhase.Composing, failed.phase)
            sheet.issue()
            sheet.state.first { it.phase == RxPhase.Issued }
            assertEquals(1, backend.count(patient))
        }

    @Test
    fun a_failed_link_can_be_made_again_without_reissuing() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            backend.on(share, {
                apiError(HttpStatusCode.ServiceUnavailable, "unavailable")
            }, {
                json(
                    """{"id":"s1","token":"t","pin":"111111","expires_at":"2026-10-08T05:00:00Z"}""",
                    HttpStatusCode.Created,
                )
            })
            val sheet = holder(backend)
            sheet.add(sheet.pick())
            sheet.issue()
            assertIs<ShareState.Failed>(sheet.state.first { it.share is ShareState.Failed }.share)
            sheet.share()
            assertNotNull(sheet.state.first { it.share is ShareState.Ready })
            assertEquals(1, backend.count(issue))
        }

    @Test
    fun without_the_prescribe_permission_nothing_is_requested() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            val sheet = holder(backend, permissions = listOf("patients.read", "clinical.read"))
            assertFalse(sheet.state.value.allowed)
            sheet.search("amox")
            sheet.issue()
            assertEquals(0, backend.count("$SUNRISE/api/v1/drugs/search"))
            assertEquals(0, backend.count(patient))
        }

    @Test
    fun quick_rx_starts_from_the_last_issued_prescription() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            backend.on("$patient/last", { json(rx("r0", "issued", "RX-9")) })
            val sheet = holder(backend, listOf(penicillin))
            sheet.quickRx()
            val state = sheet.state.first { it.lines.isNotEmpty() }
            assertEquals("AMOXICILLIN", state.lines.single().name)
            assertEquals(1, state.warnings.size)
        }

    @Test
    fun quick_rx_with_no_earlier_prescription_says_so() =
        runTest {
            val backend = FakeBackend().also { it.serve() }
            backend.on("$patient/last", { apiError(HttpStatusCode.NotFound, "not_found") })
            val sheet = holder(backend)
            sheet.quickRx()
            assertEquals(ScreenError.NotFound, sheet.state.first { it.error != null }.error)
        }
}
