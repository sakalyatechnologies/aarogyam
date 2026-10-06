package com.aarogyam.staff.today

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ME_TWO_CLINICS
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.SUPABASE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicPickerState
import com.aarogyam.staff.json
import com.aarogyam.staff.jwt
import com.aarogyam.staff.sessionBody
import com.aarogyam.staff.sessionJson
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.todayBody
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TodayStateHolderTest {
    private suspend fun open(
        backend: FakeBackend,
        scope: CoroutineScope,
        background: CoroutineScope,
        permissions: List<String> = listOf("appointments.read"),
        logs: MemoryLogSink = MemoryLogSink(),
    ): Pair<AppGraph, ClinicContext> {
        backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
        backend.on("$SUNRISE/api/v1/session", { json(sessionBody(permissions)) })
        val graph = testGraph(backend, background, logs = logs)
        signIn(graph, backend)
        val picker = graph.clinicPicker(scope, autoOpenSingle = false)
        picker.state.first { it is ClinicPickerState.Choose }
        picker.select("sunrise")
        return graph to
            graph.directory.current
                .filterNotNull()
                .first()
    }

    @Test
    fun one_request_builds_the_day_in_the_clinic_time_zone() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)

            val view = (holder.state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(1, backend.count("$SUNRISE/api/v1/today"))
            assertEquals("Sunrise Dental", view.clinicName)
            assertEquals("Dr. Patil", view.memberName)
            assertEquals(DayPart.Morning, view.dayPart) // 04:15 UTC is 09:45 in Kolkata
            assertEquals(TodayCountsView(visits = 3, waiting = 2, done = 1), view.counts)
            assertEquals(listOf("Meera Shah", "Kavya Reddy", "Rohan Iyer"), view.schedule.map { it.patientName })
            assertEquals(LocalTime(9, 0), view.schedule[0].starts)
            assertEquals(HeroKind.UpNext, view.heroKind)
            assertEquals("Kavya Reddy", view.hero?.patientName)
            assertEquals(VisitStatus.Arrived, view.hero?.status)
        }

    @Test
    fun the_patient_in_the_chair_is_the_hero() =
        runTest {
            val backend = FakeBackend()
            val body =
                todayBody(
                    appointments =
                        listOf(
                            com.aarogyam.staff.appointment("1", "2026-10-05T04:45:00Z", "booked", "Kavya Reddy"),
                            com.aarogyam.staff.appointment("2", "2026-10-05T05:15:00Z", "in_chair", "Rohan Iyer"),
                        ),
                )
            backend.on("$SUNRISE/api/v1/today", { json(body) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(HeroKind.Now, view.heroKind)
            assertEquals("Rohan Iyer", view.hero?.patientName)
        }

    @Test
    fun without_appointments_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val (graph, clinic) = open(backend, this, backgroundScope, permissions = listOf("patients.read"))
            val holder = graph.today(clinic, this)
            assertEquals(TodayState.NotAllowed, holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count("$SUNRISE/api/v1/today"))
        }

    @Test
    fun a_failed_refresh_keeps_the_day_on_screen() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { json(todayBody()) },
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
            )
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            holder.refresh()
            val state = holder.state.first { it is TodayState.Loaded && it.error != null } as TodayState.Loaded
            assertEquals(ScreenError.NotAllowed, state.error)
            assertEquals(3, state.view.schedule.size)
        }

    @Test
    fun an_expired_token_is_refreshed_once_and_the_request_retried() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { apiError(HttpStatusCode.Unauthorized, "unauthenticated") },
                { json(todayBody()) },
            )
            backend.on("$SUPABASE/auth/v1/token", { json(sessionJson(access = jwt("b"), refresh = "r2")) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            assertEquals(1, backend.count("$SUPABASE/auth/v1/token"))
            val retried = backend.requests.filter { it.url.encodedPath == "/api/v1/today" }
            assertEquals(2, retried.size)
            assertTrue(retried[0].headers["Authorization"] != retried[1].headers["Authorization"])
        }

    @Test
    fun patient_details_never_reach_the_logs() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { json(todayBody()) },
                { apiError(HttpStatusCode.NotImplemented, "internal") },
            )
            val logs = MemoryLogSink()
            val (graph, clinic) = open(backend, this, backgroundScope, logs = logs)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            holder.refresh()
            holder.state.first { it is TodayState.Loaded && it.error != null }
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue(text.contains("today.load_failed"))
            listOf("Kavya Reddy", "SC-102", "Braces", "asha.patil", "Dr. Patil").forEach { assertTrue(it !in text, it) }
        }

    @Test
    fun a_failed_first_load_shows_the_error() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { apiError(HttpStatusCode.NotImplemented, "internal") })
            val (graph, clinic) = open(backend, this, backgroundScope)
            assertEquals(
                TodayState.Failed(ScreenError.Server),
                graph.today(clinic, this).state.first { it is TodayState.Failed },
            )
        }
}
