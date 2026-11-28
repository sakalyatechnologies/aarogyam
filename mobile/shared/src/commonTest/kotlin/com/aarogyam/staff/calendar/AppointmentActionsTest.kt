package com.aarogyam.staff.calendar

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.today.VisitStatus
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

class AppointmentActionsTest {
    private val status = "$SUNRISE/api/v1/appointments/a1/status"
    private val move = "$SUNRISE/api/v1/appointments/a1/move"
    private val clock = Instant.parse("2026-10-05T04:15:00Z")

    private fun entry(
        statusOf: VisitStatus = VisitStatus.Booked,
        origin: String = "website",
        startsAt: Instant = Instant.parse("2026-10-05T05:00:00Z"),
        walkIn: Boolean = false,
    ) = CalendarEntry(
        "a1",
        "p1",
        "Meera Shah",
        "SC-101",
        LocalTime(10, 30),
        LocalTime(11, 0),
        statusOf,
        null,
        null,
        "d1",
        "Dr. Patil",
        null,
        null,
        walkIn,
        origin,
        startsAt,
    )

    private fun changed(state: String = "confirmed") =
        """{"appointment":${appointment("a1", "2026-10-05T05:00:00Z", state, "Meera Shah")}}"""

    private fun HttpRequestData.text() = (body as TextContent).text

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("appointments.write"),
        onChanged: () -> Unit = {},
        e: CalendarEntry = entry(),
    ): AppointmentActionsHolder {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions)
        return AppointmentActionsHolder(clinic, e, backgroundScope, onChanged, now = { clock })
    }

    @Test
    fun online_means_a_booked_request_from_the_website_or_app() {
        assertTrue(entry().online)
        assertTrue(entry(origin = "app").online)
        assertFalse(entry(origin = "front_desk").online)
        assertFalse(entry(statusOf = VisitStatus.Confirmed).online)
    }

    @Test
    fun actions_follow_status_time_and_permission() {
        val early = Instant.parse("2026-10-05T03:00:00Z")
        assertEquals(
            listOf(ApptAction.Confirm, ApptAction.Reschedule, ApptAction.Cancel, ApptAction.Call),
            entry().actions(clock, true),
        )
        assertEquals(
            listOf(ApptAction.Reschedule, ApptAction.Cancel, ApptAction.NoShow, ApptAction.Call),
            entry(VisitStatus.Confirmed, startsAt = early).actions(clock, true),
        )
        assertEquals(listOf(ApptAction.Call), entry().actions(clock, false))
        assertEquals(listOf(ApptAction.Call), entry(VisitStatus.Arrived, startsAt = early).actions(clock, true))
        assertTrue(entry(walkIn = true).actions(clock, true).isEmpty())
    }

    @Test
    fun confirm_sends_the_status_and_reloads_the_day() =
        runTest {
            val backend = FakeBackend()
            backend.on(status, { json(changed()) })
            var reloads = 0
            val holder = holder(backend, onChanged = { reloads++ })
            holder.confirm()
            holder.state.first { it.done == ApptAction.Confirm }
            val body = backend.requests.last { it.url.encodedPath.endsWith("/status") }.text()
            assertEquals("""{"status":"confirmed"}""", body.replace(" ", ""))
            assertEquals(1, reloads)
        }

    @Test
    fun a_taken_time_asks_then_retries_with_double_book() =
        runTest {
            val backend = FakeBackend()
            backend.on(status, { apiError(HttpStatusCode.Conflict, "slot_occupied") })
            val holder = holder(backend)
            holder.confirm()
            val asked = holder.state.first { it.askDoubleBook }
            assertNull(asked.error)
            backend.on(status, { json(changed()) })
            holder.confirmAnyway()
            holder.state.first { it.done != null }
            val body = backend.requests.last { it.url.encodedPath.endsWith("/status") }.text()
            assertTrue(body.contains("\"double_book\":true"))
            assertFalse(holder.state.value.askDoubleBook)
        }

    @Test
    fun cancel_needs_a_reason_and_sends_it_trimmed() =
        runTest {
            val backend = FakeBackend()
            backend.on(status, { json(changed("cancelled")) })
            val holder = holder(backend)
            holder.cancel("   ")
            assertEquals(0, backend.count(status.removePrefix("https://")))
            holder.cancel("  ${CancelReason.Duplicate.text} ")
            holder.state.first { it.done == ApptAction.Cancel }
            val body = backend.requests.last { it.url.encodedPath.endsWith("/status") }.text()
            assertTrue(body.contains("\"status\":\"cancelled\""))
            assertTrue(body.contains("\"reason\":\"Duplicate\""))
        }

    @Test
    fun no_show_sends_its_status() =
        runTest {
            val backend = FakeBackend()
            backend.on(status, { json(changed("no_show")) })
            val holder = holder(backend)
            holder.noShow()
            holder.state.first { it.done == ApptAction.NoShow }
            assertTrue(
                backend.requests
                    .last { it.url.encodedPath.endsWith("/status") }
                    .text()
                    .contains("no_show"),
            )
        }

    @Test
    fun without_write_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            backend.on(status, { json(changed()) })
            val holder = holder(backend, permissions = listOf("appointments.read"))
            holder.confirm()
            assertEquals(0, backend.requests.count { it.url.encodedPath.endsWith("/status") })
            assertEquals(listOf(ApptAction.Call), holder.actions())
        }

    @Test
    fun a_move_sends_the_start_and_only_a_different_doctor() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/practitioners", { json("""{"items":[]}""") })
            backend.on(
                "$SUNRISE/api/v1/public/availability",
                {
                    json(
                        """{"date":"2026-10-06","practitioner_id":"d1","slot_minutes":30,
                           "slots":["2026-10-06T10:00:00+05:30"],"requestable_slots":[]}""",
                    )
                },
            )
            backend.on(move, { json(changed()) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.write"))
            var reloads = 0
            val holder = RescheduleStateHolder(clinic, entry(), LocalDate(2026, 10, 6), backgroundScope, { reloads++ })
            holder.chooseSlot(
                holder.state
                    .first { it.slots.isNotEmpty() }
                    .slots
                    .first(),
            )
            holder.move()
            holder.state.first { it.moved }
            val body = backend.requests.last { it.url.encodedPath.endsWith("/move") }.text()
            assertTrue(body.contains("2026-10-06T04:30:00Z"))
            assertFalse(body.contains("practitioner_id\":\"d"))
            assertEquals(1, reloads)
        }
}
