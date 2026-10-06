package com.aarogyam.staff.calendar

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Instant

class CalendarStateHolderTest {
    private val route = "$SUNRISE/api/v1/appointments"
    private val doctors = """{"items":[{"id":"d1","display_name":"Dr. Patil","calendar_color":"#0E7490","active":true},
        {"id":"d2","display_name":"Dr. Rao","calendar_color":"#7C3AED","active":true}]}"""
    private val rooms =
        """{"items":[{"id":"r1","branch_id":"b1","name":"Chair 1","kind":"chair","active":true,"sort_order":1}]}"""

    // 09:45 on 5 Oct in Kolkata.
    private val clock = Instant.parse("2026-10-05T04:15:00Z")

    private fun withRoom(
        body: String,
        room: String?,
        doctor: String,
    ) = body
        .replace("\"room\":\"Chair 1\"", "\"room\":\"Chair 1\",\"room_id\":${room?.let { "\"$it\"" }}")
        .replace("\"id\":\"d1\"", "\"id\":\"$doctor\"")

    private fun day() =
        """{"items":[${listOf(
            withRoom(appointment("1", "2026-10-05T03:30:00Z", "completed", "Meera Shah", "Root canal"), "r1", "d1"),
            withRoom(appointment("2", "2026-10-05T04:45:00Z", "arrived", "Kavya Reddy", "Braces"), null, "d2"),
            withRoom(appointment("3", "2026-10-05T05:15:00Z", "cancelled", "Asha Rao"), "r1", "d1"),
        ).joinToString(",")}]}"""

    private fun FakeBackend.serve(appointments: String = day()) {
        on(route, { json(appointments) })
        on("$SUNRISE/api/v1/practitioners", { json(doctors) })
        on("$SUNRISE/api/v1/rooms", { json(rooms) })
    }

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("appointments.read"),
        logs: MemoryLogSink = MemoryLogSink(),
    ): CalendarStateHolder {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return CalendarStateHolder(
            clinic,
            backgroundScope,
            Logger("aarogyam.calendar", logs, LogLevel.Debug),
            now = { clock },
        )
    }

    private suspend fun CalendarStateHolder.loaded() =
        state.first { it is CalendarState.Loaded && !it.refreshing } as CalendarState.Loaded

    @Test
    fun the_day_is_one_request_with_the_clinic_local_date_and_times() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val state = holder(backend).loaded()
            assertEquals(1, backend.count(route))
            val query =
                backend.requests
                    .first { it.url.encodedPath == "/api/v1/appointments" }
                    .url.parameters
            assertEquals("2026-10-05", query["from"])
            assertEquals("2026-10-05", query["to"])
            assertEquals(LocalDate(2026, 10, 5), state.date)
            assertTrue(state.isToday)
            assertEquals(listOf("Meera Shah", "Kavya Reddy"), state.entries.map { it.patientName })
            assertEquals(LocalTime(9, 0), state.entries[0].starts)
            assertEquals(listOf("Dr. Patil", "Dr. Rao"), state.columns.map { it.name })
            assertEquals(listOf(1, 1), state.columns.map { it.count })
        }

    @Test
    fun switching_mode_or_column_reuses_the_answer_and_the_cached_reference_data() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend)
            holder.loaded()
            holder.select("d2")
            assertEquals(listOf("Kavya Reddy"), holder.loaded().entries.map { it.patientName })
            holder.setMode(CalendarMode.Chair)
            var state = holder.loaded()
            assertEquals(listOf("Chair 1"), state.columns.map { it.name })
            assertEquals(null, state.selected)
            holder.select("r1")
            state = holder.loaded()
            assertEquals(listOf("Meera Shah"), state.entries.map { it.patientName })
            holder.select("r1")
            assertEquals(2, holder.loaded().entries.size)
            assertEquals(1, backend.count(route))
            assertEquals(1, backend.count("$SUNRISE/api/v1/practitioners"))
            assertEquals(1, backend.count("$SUNRISE/api/v1/rooms"))
        }

    @Test
    fun swiping_to_the_next_and_previous_day_asks_for_that_day_and_reference_data_is_not_refetched() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            val holder = holder(backend)
            holder.loaded()
            holder.next()
            assertEquals(LocalDate(2026, 10, 6), holder.loaded().date)
            holder.previous()
            holder.loaded()
            holder.previous()
            val state = holder.loaded()
            assertEquals(LocalDate(2026, 10, 4), state.date)
            assertEquals(false, state.isToday)
            val asked =
                backend.requests
                    .filter { it.url.encodedPath == "/api/v1/appointments" }
                    .map { it.url.parameters["from"] }
            assertEquals(listOf("2026-10-05", "2026-10-06", "2026-10-05", "2026-10-04"), asked)
            assertEquals(1, backend.count("$SUNRISE/api/v1/practitioners"))
        }

    @Test
    fun an_empty_day_loads_with_no_entries() =
        runTest {
            val backend = FakeBackend()
            backend.serve("""{"items":[]}""")
            val state = holder(backend).loaded()
            assertTrue(state.entries.isEmpty())
            assertEquals(listOf(0, 0), state.columns.map { it.count })
        }

    @Test
    fun without_reference_data_the_day_still_shows_unfiltered() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on("$SUNRISE/api/v1/practitioners", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val state = holder(backend).loaded()
            assertTrue(state.columns.isEmpty())
            assertEquals(2, state.entries.size)
        }

    @Test
    fun a_failed_day_shows_the_error_and_a_failed_refresh_keeps_the_day() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(
                route,
                { apiError(HttpStatusCode.NotImplemented, "internal") },
                { json(day()) },
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
            )
            val holder = holder(backend)
            val failed = holder.state.first { it is CalendarState.Failed }
            assertEquals(CalendarState.Failed(LocalDate(2026, 10, 5), ScreenError.Server), failed)
            holder.refresh()
            holder.loaded()
            holder.refresh()
            val state = holder.state.first { it is CalendarState.Loaded && it.error != null } as CalendarState.Loaded
            assertEquals(ScreenError.NotAllowed, state.error)
            assertEquals(2, state.entries.size)
        }

    @Test
    fun without_appointments_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("patients.read"))
            assertEquals(CalendarState.NotAllowed, holder.state.value)
            holder.next()
            assertEquals(0, backend.count(route))
        }

    @Test
    fun patient_details_never_reach_the_logs() =
        runTest {
            val backend = FakeBackend()
            backend.serve()
            backend.on(route, { apiError(HttpStatusCode.NotImplemented, "internal") })
            val logs = MemoryLogSink()
            holder(backend, logs = logs).state.first { it is CalendarState.Failed }
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue(text.contains("calendar.load_failed"))
            listOf("Meera", "Kavya", "Root canal", "SC-10").forEach { assertTrue(it !in text, it) }
        }
}
