package com.aarogyam.staff.patients

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patientJson
import com.aarogyam.staff.patientListJson
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class PatientsStateHolderTest {
    private val route = "$SUNRISE/api/v1/patients/search"
    private val meera = patientJson("p1", "Meera Shah")

    private suspend fun kotlinx.coroutines.test.TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read"),
        logs: MemoryLogSink = MemoryLogSink(),
    ): PatientsStateHolder {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.patients(clinic, backgroundScope)
    }

    @Test
    fun opening_lists_the_newest_patients_with_one_request() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientListJson(meera)) })
            val state = holder(backend).state.first { it is PatientsState.Loaded } as PatientsState.Loaded
            assertEquals(1, backend.count(route))
            assertEquals(HttpMethod.Post, backend.requests.last().method)
            assertEquals(listOf("Meera Shah"), state.items.map { it.name })
            assertEquals("SD-1042", state.items[0].number)
            assertEquals(Sex.Female, state.items[0].sex)
            assertTrue(
                backend.requests
                    .last()
                    .body
                    .toString()
                    .isNotEmpty(),
            )
        }

    @Test
    fun typing_sends_one_request_for_the_final_query_after_a_pause() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientListJson(meera)) })
            val holder = holder(backend)
            holder.state.first { it is PatientsState.Loaded }
            "Meera".indices.forEach { holder.search("Meera".take(it + 1)) }
            advanceTimeBy(299)
            assertEquals(1, backend.count(route)) // still only the opening list
            advanceTimeBy(2)
            val state = holder.state.first { it is PatientsState.Loaded && !it.searching } as PatientsState.Loaded
            assertEquals(2, backend.count(route))
            assertEquals("Meera", state.query)
            assertTrue(
                backend.requests
                    .last()
                    .url.encodedQuery
                    .isEmpty(),
                "terms stay out of the URL",
            )
        }

    @Test
    fun the_same_query_twice_sends_nothing_new() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientListJson(meera)) })
            val holder = holder(backend)
            holder.state.first { it is PatientsState.Loaded }
            holder.search("Meera")
            advanceTimeBy(400)
            holder.state.first { it is PatientsState.Loaded && !it.searching }
            holder.search(" Meera ")
            advanceTimeBy(400)
            assertEquals(2, backend.count(route))
        }

    @Test
    fun a_query_without_matches_is_an_empty_list() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientListJson(meera)) }, { json(patientListJson()) })
            val holder = holder(backend)
            holder.state.first { it is PatientsState.Loaded }
            holder.search("zzz")
            advanceTimeBy(400)
            val state = holder.state.first { it is PatientsState.Loaded && it.items.isEmpty() } as PatientsState.Loaded
            assertEquals("zzz", state.query)
        }

    @Test
    fun a_failed_search_shows_the_error_and_retry_runs_it_again() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                { apiError(HttpStatusCode.NotImplemented, "internal") },
                { json(patientListJson(meera)) },
            )
            val holder = holder(backend)
            assertEquals(
                PatientsState.Failed("", ScreenError.Server),
                holder.state.first { it is PatientsState.Failed },
            )
            holder.retry()
            assertIs<PatientsState.Loaded>(holder.state.first { it is PatientsState.Loaded })
            assertEquals(2, backend.count(route))
        }

    @Test
    fun without_patients_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("appointments.read"))
            assertEquals(PatientsState.NotAllowed, holder.state.value)
            holder.search("Meera")
            advanceTimeBy(400)
            assertEquals(0, backend.count(route))
        }

    @Test
    fun names_and_numbers_never_reach_the_logs() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientListJson(meera)) }, { apiError(HttpStatusCode.NotImplemented, "internal") })
            val logs = MemoryLogSink()
            val holder = holder(backend, logs = logs)
            holder.state.first { it is PatientsState.Loaded }
            holder.search("Meera Shah")
            advanceTimeBy(400)
            holder.state.first { it is PatientsState.Failed }
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue(text.contains("patients.search_failed"))
            listOf("Meera", "Shah", "SD-1042", "3210").forEach { assertTrue(it !in text, it) }
        }
}
