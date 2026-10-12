package com.aarogyam.staff.schedule

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

class WeekStateHolderTest {
    private val wednesday = LocalDate(2026, 10, 7)

    private fun list(vararg items: String) = """{"items":${items.joinToString(",", "[", "]")}}"""

    @Test
    fun the_week_runs_monday_to_sunday_in_one_request() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/appointments",
                {
                    json(
                        list(
                            // 03:30Z and 03:45Z are 09:00 and 09:15 in Kolkata.
                            appointment("1", "2026-10-05T03:30:00Z", "booked", "A"),
                            appointment("2", "2026-10-05T03:45:00Z", "completed", "B"),
                            appointment("3", "2026-10-07T08:30:00Z", "booked", "C"),
                            appointment("4", "2026-10-07T08:30:00Z", "cancelled", "D"),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = WeekStateHolder(clinic, this, today = { wednesday })
            val loaded = holder.state.first { it is WeekState.Loaded } as WeekState.Loaded
            val request = backend.requests.last { it.url.encodedPath == "/api/v1/appointments" }
            assertEquals("2026-10-05", request.url.parameters["from"])
            assertEquals("2026-10-11", request.url.parameters["to"])
            assertEquals(LocalDate(2026, 10, 5), loaded.start)
            assertEquals(listOf(2, 0, 1, 0, 0, 0, 0), loaded.view.days.map { it.total })
            assertEquals(mapOf(9 to 2), loaded.view.days[0].byHour)
            assertEquals(mapOf(14 to 1), loaded.view.days[2].byHour)
            assertEquals(2, loaded.view.peak)
            assertEquals(9..19, loaded.view.hours)
        }

    @Test
    fun next_week_asks_for_the_next_seven_days() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/appointments", { json(list()) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = WeekStateHolder(clinic, this, today = { wednesday })
            holder.state.first { it is WeekState.Loaded }
            holder.next()
            val loaded =
                holder.state.first {
                    it is WeekState.Loaded && it.start ==
                        LocalDate(
                            2026,
                            10,
                            12,
                        )
                } as WeekState.Loaded
            assertEquals(0, loaded.view.peak)
            assertEquals(
                "2026-10-18",
                backend.requests
                    .last()
                    .url.parameters["to"],
            )
        }

    @Test
    fun without_appointments_read_nothing_is_requested_and_failures_show() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/appointments", { apiError(HttpStatusCode.InternalServerError, "internal") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            assertEquals(WeekState.NotAllowed, WeekStateHolder(clinic, this, today = { wednesday }).state.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/appointments"))
        }

    @Test
    fun a_failed_week_shows_the_error() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/appointments", { apiError(HttpStatusCode.InternalServerError, "internal") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val failed = WeekStateHolder(clinic, this, today = { wednesday }).state.first { it is WeekState.Failed }
            assertEquals(WeekState.Failed(ScreenError.Server), failed)
        }

    @Test
    fun mondays_are_found_from_any_day() {
        assertEquals(LocalDate(2026, 10, 5), WeekStateHolder.mondayOf(LocalDate(2026, 10, 11)))
        assertEquals(LocalDate(2026, 10, 5), WeekStateHolder.mondayOf(LocalDate(2026, 10, 5)))
    }
}
