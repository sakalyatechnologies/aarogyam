package com.aarogyam.staff.patients

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patientJson
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class Patient360StateHolderTest {
    private val base = "$SUNRISE/api/v1/patients/p1"
    private val flags =
        """{"allergy_count":1,"severe_allergy":true,"condition_count":1,"details_hidden":false,
           "allergies":[{"id":"a1","substance":"Penicillin","severity":"severe","reaction":"Rash","status":"active","source":"staff",
             "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}],
           "conditions":[{"id":"c1","display_text":"Diabetes","flagged":true,"status":"active","source":"staff",
             "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}]}"""
    private val hiddenFlags =
        """{"allergy_count":1,"severe_allergy":true,"condition_count":0,"details_hidden":true,
           "allergies":[],"conditions":[]}"""
    private val visits =
        """{"items":[{"id":"v1","number":"V-318","patient_id":"p1","clinician":{"id":"m1","name":"Dr. Patil"},
           "status":"closed","started_at":"2026-09-20T04:30:00Z","chief_complaint":"Toothache"}]}"""

    private fun FakeBackend.serve(
        patient: String = patientJson("p1", "Meera Shah"),
        flags: String = this@Patient360StateHolderTest.flags,
    ) {
        on(base, { json(patient) })
        on("$base/clinical-flags", { json(flags) })
        on("$base/visits", { json(visits) })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "clinical.read", "billing.read"),
        logs: MemoryLogSink = MemoryLogSink(),
    ): Patient360StateHolder {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.patient360(clinic, "p1", backgroundScope)
    }

    private suspend fun Patient360StateHolder.view() =
        (
            state.first {
                it is Patient360State.Loaded
            } as Patient360State.Loaded
        ).view

    @Test
    fun the_overview_is_three_requests_in_the_clinic_time_zone() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val view = holder(backend).view()
            listOf(base, "$base/clinical-flags", "$base/visits").forEach { assertEquals(1, backend.count(it), it) }
            assertEquals("Meera Shah", view.name)
            assertEquals(Sex.Female, view.sex)
            assertEquals(
                Severity.Severe,
                view.flags.allergies
                    .single()
                    .severity,
            )
            assertEquals(listOf("Diabetes"), view.flags.conditions)
            val next = view.upcoming.single()
            assertEquals(LocalDate(2026, 10, 12), next.at.date)
            assertEquals(LocalTime(10, 0), next.at.time) // 04:30 UTC is 10:00 in Kolkata
            assertEquals("Dr. Patil", next.practitioner)
            val visit = view.visits?.single()
            assertEquals("V-318", visit?.number)
            assertEquals("Toothache", visit?.reason)
            assertEquals(125000L, view.balancePaise)
        }

    @Test
    fun the_balance_is_hidden_without_billing_read_even_if_the_server_sent_it() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val view = holder(backend, permissions = listOf("patients.read", "clinical.read")).view()
            assertNull(view.balancePaise)
        }

    @Test
    fun without_clinical_read_the_banner_keeps_its_counts_only() =
        runTest {
            val backend = FakeBackend()
            backend.serve(flags = hiddenFlags)
            val flags = holder(backend, permissions = listOf("patients.read")).view().flags
            assertTrue(flags.detailsHidden && flags.hasFlags)
            assertEquals(1, flags.allergyCount)
            assertTrue(flags.allergies.isEmpty())
        }

    @Test
    fun a_patient_with_no_history_still_loads() =
        runTest {
            val backend = FakeBackend()
            backend.serve(patient = patientJson("p1", "Meera Shah", balance = null, next = null))
            backend.on("$base/visits", { json("""{"items":[]}""") })
            backend.on("$base/clinical-flags", {
                json(
                    """{"allergy_count":0,"severe_allergy":false,"condition_count":0,"details_hidden":false,
                       "allergies":[],"conditions":[]}""",
                )
            })
            val view = holder(backend).view()
            assertTrue(view.upcoming.isEmpty())
            assertTrue(view.visits.orEmpty().isEmpty())
            assertTrue(!view.flags.hasFlags)
            assertNull(view.balancePaise)
        }

    @Test
    fun a_role_that_may_not_list_visits_just_loses_that_section() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on("$base/visits", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            assertNull(holder(backend).view().visits)
        }

    @Test
    fun a_missing_banner_fails_the_screen_rather_than_hiding_allergies() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on("$base/clinical-flags", { apiError(HttpStatusCode.NotImplemented, "internal") })
            assertEquals(
                Patient360State.Failed(ScreenError.Server),
                holder(backend).state.first { it is Patient360State.Failed },
            )
        }

    @Test
    fun an_unknown_patient_is_not_found() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(base, { apiError(HttpStatusCode.NotFound, "not_found") })
            assertEquals(
                Patient360State.Failed(ScreenError.NotFound),
                holder(backend).state.first { it is Patient360State.Failed },
            )
        }

    @Test
    fun a_failed_refresh_keeps_the_record_on_screen() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(
                base,
                { json(patientJson("p1", "Meera Shah")) },
                { apiError(HttpStatusCode.NotImplemented, "internal") },
            )
            val holder = holder(backend)
            holder.view()
            holder.refresh()
            val state =
                holder.state.first {
                    it is Patient360State.Loaded && it.error != null
                } as Patient360State.Loaded
            assertEquals(ScreenError.Server, state.error)
            assertEquals("Meera Shah", state.view.name)
        }

    @Test
    fun without_patients_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("appointments.read"))
            assertEquals(Patient360State.NotAllowed, holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count(base))
        }

    @Test
    fun patient_details_never_reach_the_logs() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on("$base/visits", { apiError(HttpStatusCode.NotImplemented, "internal") })
            val logs = MemoryLogSink()
            holder(backend, logs = logs).state.first { it is Patient360State.Failed }
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue(text.contains("patient360.load_failed"))
            listOf("Meera", "SD-1042", "Penicillin", "Diabetes", "3210").forEach { assertTrue(it !in text, it) }
        }
}
