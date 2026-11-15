package com.aarogyam.patient

import com.aarogyam.patient.records.ListState
import com.aarogyam.patient.visits.VisitState
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SUNRISE_SUFFIX = "-aarogyam.spring-snow-130f.workers.dev"

class VisitsStateHoldersTest {
    private val listRoute = "$DEMO_APP/api/v1/me/patient/visits"

    private fun visit(
        id: String,
        on: String,
        clinicId: String? = SUNRISE_ID,
        clinicName: String = "Sunrise Dental",
    ): String =
        """{"id":"$id","clinic_id":${clinicId?.let {
            "\"$it\""
        }},"number":"V-1","clinic_name":"$clinicName","visited_on":"$on",
           "doctor_name":"Dr Asha Rao",
           "treatments":[{"name":"Scaling","tooth":null,"surfaces":[]},{"name":"Filling","tooth":16,"surfaces":["O","D"]}],
           "advice":"Rinse with warm saline","prescription":{"number":"RX-12","issued_on":"$on",
           "items":[{"drug_name":"AMOXICILLIN","strength":"500 mg","form":"capsule","dose":"1","frequency":"1-0-1",
           "timing":"after_food","duration_days":5,"instructions":null}]},
           "next_follow_up":{"due_on":"2026-11-20","kind":"follow_up"},
           "earlier_visits":[{"visited_on":"2026-09-01","title":"Consultation"}],"booking_path":"/book"}"""

    @Test
    fun list_is_newest_first_across_clinics_with_iso_dates() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                listRoute,
                {
                    json(
                        """{"items":[${visit(
                            "v1",
                            "2026-10-01",
                        )},${visit("v2", "2026-10-09", LOTUS_ID, "Lotus Clinic")}]}""",
                    )
                },
            )
            val graph = signedIn(backend, backgroundScope)
            val loaded = graph.visits(backgroundScope).state.first { it is ListState.Loaded } as ListState.Loaded
            assertEquals(listOf("v2", "v1"), loaded.items.map { it.id })
            val first = loaded.items.last()
            assertEquals("2026-10-01", first.visitedOn)
            assertEquals(listOf("Scaling", "Filling"), first.treatments.map { it.name })
            assertEquals(16, first.treatments.last().tooth)
            assertEquals("https://sunrise$SUNRISE_SUFFIX/book", first.bookingUrl)
            assertEquals(
                "after_food",
                first.prescription
                    ?.medicines
                    ?.single()
                    ?.timing,
            )
        }

    @Test
    fun list_with_no_visits_is_loaded_and_empty() =
        runTest {
            val backend = FakeBackend()
            backend.on(listRoute, { json("""{"items":[]}""") })
            val graph = signedIn(backend, backgroundScope)
            val loaded = graph.visits(backgroundScope).state.first { it is ListState.Loaded } as ListState.Loaded
            assertTrue(loaded.items.isEmpty())
        }

    @Test
    fun list_failure_is_failed_and_refresh_recovers() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                listRoute,
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
                { json("""{"items":[${visit("v1", "2026-10-01")}]}""") },
            )
            val graph = signedIn(backend, backgroundScope)
            val holder = graph.visits(backgroundScope)
            val failed = holder.state.first { it !is ListState.Loading }
            assertEquals(ScreenError.NotAllowed, assertIs<ListState.Failed>(failed).error)
            holder.refresh()
            val loaded = holder.state.first { it is ListState.Loaded } as ListState.Loaded
            assertEquals("v1", loaded.items.single().id)
        }

    @Test
    fun detail_loads_one_visit() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me/patient/visits/v1", { json(visit("v1", "2026-10-01")) })
            val graph = signedIn(backend, backgroundScope)
            val state = graph.visit(backgroundScope, "v1").state.first { it is VisitState.Loaded } as VisitState.Loaded
            assertEquals("2026-11-20", state.visit.nextFollowUp?.dueOn)
            assertEquals(
                "Consultation",
                state.visit.earlierVisits
                    .single()
                    .title,
            )
            assertEquals("Rinse with warm saline", state.visit.advice)
            assertEquals(SUNRISE_ID, state.visit.clinicId)
        }

    @Test
    fun detail_without_a_clinic_has_no_booking_url() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me/patient/visits/v1", { json(visit("v1", "2026-10-01", clinicId = null)) })
            val graph = signedIn(backend, backgroundScope)
            val state = graph.visit(backgroundScope, "v1").state.first { it is VisitState.Loaded } as VisitState.Loaded
            assertNull(state.visit.clinicId)
            assertNull(state.visit.bookingUrl)
        }

    @Test
    fun detail_of_another_patients_visit_is_not_found() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me/patient/visits/other", { apiError(HttpStatusCode.NotFound, "not_found") })
            val graph = signedIn(backend, backgroundScope)
            val state = graph.visit(backgroundScope, "other").state.first { it !is VisitState.Loading }
            assertEquals(ScreenError.NotFound, assertIs<VisitState.Failed>(state).error)
        }

    @Test
    fun detail_failure_keeps_the_loaded_visit_on_refresh() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me/patient/visits/v1",
                { json(visit("v1", "2026-10-01")) },
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
            )
            val graph = signedIn(backend, backgroundScope)
            val holder = graph.visit(backgroundScope, "v1")
            holder.state.first { it is VisitState.Loaded }
            holder.refresh()
            withContext(Dispatchers.Default) {
                withTimeout(10_000) { while (backend.count("$DEMO_APP/api/v1/me/patient/visits/v1") < 2) delay(10) }
                delay(100)
            }
            assertIs<VisitState.Loaded>(holder.state.value)
        }
}
