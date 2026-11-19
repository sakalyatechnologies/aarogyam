package com.aarogyam.staff.calendar

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.model.CalendarWalkIn
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.schedule.WeekState
import com.aarogyam.staff.schedule.WeekStateHolder
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.today.VisitStatus
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

class CalendarWalkInsTest {
    private val walkIns = "$SUNRISE/api/v1/calendar/walk-ins"
    private val parser = Json { ignoreUnknownKeys = true }

    // 09:45 on 5 Oct in Kolkata.
    private val clock = Instant.parse("2026-10-05T04:15:00Z")

    private fun walkIn(
        id: String,
        startsAt: String,
        status: String,
        name: String,
        endsAt: String? = null,
        room: String? = null,
        doctor: Boolean = true,
    ) = """{"visit_id":"v$id","starts_at":"$startsAt","ends_at":${endsAt?.let {
        "\"$it\""
    } ?: "null"},"status":"$status",
        "room_id":${room?.let {
        "\"$it\""
    } ?: "null"},"room":${room?.let { "\"Chair 1\"" } ?: "null"},"token_number":$id,
        "patient":{"id":"p-w$id","number":"SC-20$id","full_name":"$name","sex":"male","registration_incomplete":false,"age_years":40},
        "practitioner":${if (doctor) """{"id":"d1","display_name":"Dr. Patil","calendar_color":null}""" else "null"}}"""

    private fun list(vararg items: String) = """{"items":${items.joinToString(",", "[", "]")}}"""

    private fun FakeBackend.serveDay(withWalkIns: Boolean = true) {
        on(
            "$SUNRISE/api/v1/appointments",
            { json(list(appointment("1", "2026-10-05T03:30:00Z", "booked", "Meera Shah"))) },
        )
        on("$SUNRISE/api/v1/practitioners", { json("""{"items":[]}""") })
        on("$SUNRISE/api/v1/rooms", { json("""{"items":[]}""") })
        if (withWalkIns) {
            on(
                walkIns,
                {
                    json(
                        list(
                            // 04:00Z to 04:20Z is 09:30 to 09:50 in Kolkata.
                            walkIn(
                                "7",
                                "2026-10-05T04:00:00Z",
                                "closed",
                                "Ravi Kumar",
                                endsAt = "2026-10-05T04:20:00Z",
                                room = "r1",
                            ),
                            walkIn("8", "2026-10-05T04:10:00Z", "open", "Sunil Joshi", doctor = false),
                        ),
                    )
                },
            )
        }
    }

    private suspend fun TestScope.day(
        backend: FakeBackend,
        logs: MemoryLogSink = MemoryLogSink(),
    ): CalendarState.Loaded {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
        val holder =
            CalendarStateHolder(
                clinic,
                backgroundScope,
                Logger("aarogyam.calendar", logs, LogLevel.Debug),
                now = { clock },
            )
        return holder.state.first { it is CalendarState.Loaded } as CalendarState.Loaded
    }

    @Test
    fun walk_ins_join_the_day_for_the_same_date_and_are_marked() =
        runTest {
            val backend = FakeBackend()
            backend.serveDay()
            val state = day(backend)
            val query =
                backend.requests
                    .first { it.url.encodedPath == "/api/v1/calendar/walk-ins" }
                    .url.parameters
            assertEquals("2026-10-05", query["from"])
            assertEquals("2026-10-05", query["to"])
            assertEquals(listOf("Meera Shah", "Ravi Kumar", "Sunil Joshi"), state.entries.map { it.patientName })
            assertEquals(listOf(false, true, true), state.entries.map { it.walkIn })
            val (closed, open) = state.entries.drop(1)
            assertEquals("v7", closed.appointmentId)
            assertEquals("p-w7", closed.patientId)
            assertEquals(VisitStatus.Completed, closed.status)
            assertEquals(LocalTime(9, 30) to LocalTime(9, 50), closed.starts to closed.ends)
            assertEquals("r1", closed.roomId)
            // Open today: like a patient in the chair, drawn 30 minutes, no doctor or chair (Unassigned).
            assertEquals(VisitStatus.InChair, open.status)
            assertEquals(LocalTime(9, 40) to LocalTime(10, 10), open.starts to open.ends)
            assertEquals("", open.practitionerId)
            assertEquals(null, open.roomId)
            assertFalse(state.walkInsFailed)
        }

    @Test
    fun an_open_walk_in_from_an_earlier_day_stays_neutral() {
        val earlier = parser.decodeFromString<CalendarWalkIn>(walkIn("9", "2026-10-04T04:00:00Z", "open", "X"))
        val entry = earlier.toEntry(TimeZone.of("Asia/Kolkata"), LocalDate(2026, 10, 5))
        assertEquals(VisitStatus.Unknown, entry?.status)
    }

    @Test
    fun a_failed_walk_in_call_keeps_the_appointments_with_a_note_and_logs_no_patient_data() =
        runTest {
            val backend = FakeBackend()
            backend.serveDay(withWalkIns = false)
            backend.on(walkIns, { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") })
            val logs = MemoryLogSink()
            val state = day(backend, logs)
            assertEquals(listOf("Meera Shah"), state.entries.map { it.patientName })
            assertTrue(state.walkInsFailed)
            assertTrue(logs.records.any { it.event == "calendar.walk_ins_failed" })
            assertFalse(logs.records.toString().contains("Meera"))
        }

    @Test
    fun a_server_without_the_route_shows_appointments_and_no_note() =
        runTest {
            val backend = FakeBackend()
            backend.serveDay(withWalkIns = false)
            val state = day(backend)
            assertEquals(1, state.entries.size)
            assertFalse(state.walkInsFailed)
        }

    @Test
    fun the_week_counts_walk_ins_into_each_day() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/appointments",
                { json(list(appointment("1", "2026-10-05T03:30:00Z", "booked", "A"))) },
            )
            backend.on(
                walkIns,
                {
                    json(
                        list(
                            walkIn("7", "2026-10-05T03:40:00Z", "closed", "B"),
                            walkIn("8", "2026-10-07T08:30:00Z", "open", "C"),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = WeekStateHolder(clinic, this, today = { LocalDate(2026, 10, 7) })
            val loaded = holder.state.first { it is WeekState.Loaded } as WeekState.Loaded
            val query =
                backend.requests
                    .last { it.url.encodedPath == "/api/v1/calendar/walk-ins" }
                    .url.parameters
            assertEquals("2026-10-05" to "2026-10-11", query["from"] to query["to"])
            assertEquals(listOf(2, 0, 1, 0, 0, 0, 0), loaded.view.days.map { it.total })
            assertEquals(mapOf(9 to 2), loaded.view.days[0].byHour)
            assertFalse(loaded.walkInsFailed)
        }
}
