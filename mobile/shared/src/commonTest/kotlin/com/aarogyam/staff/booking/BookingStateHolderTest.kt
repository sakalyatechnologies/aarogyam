package com.aarogyam.staff.booking

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BookingStateHolderTest {
    private val day = LocalDate(2026, 10, 9)
    private val oneDoctor =
        """{"items":[{"id":"d1","display_name":"Dr. Patil","calendar_color":"#0E7490","active":true}]}"""
    private val rooms =
        """{"items":[{"id":"r1","branch_id":"b1","name":"Chair 1","kind":"chair","active":true,"sort_order":1},
           {"id":"r9","branch_id":"b1","name":"X-ray","kind":"room","active":true,"sort_order":2}]}"""

    // 04:30Z and 05:00Z are 10:00 and 10:30 in Kolkata.
    private val slots =
        """{"date":"2026-10-09","practitioner_id":"d1","slot_minutes":30,
           "slots":["2026-10-09T10:00:00+05:30","2026-10-09T10:30:00+05:30"]}"""
    private val saved =
        """{"appointment":${appointment("7", "2026-10-09T04:30:00Z", "booked", "Meera Shah")},
           "warnings":[{"code":"outside_working_hours","message":"x"}]}"""

    private fun FakeBackend.serve() {
        on("$SUNRISE/api/v1/practitioners", { json(oneDoctor) })
        on("$SUNRISE/api/v1/rooms", { json(rooms) })
        on("$SUNRISE/api/v1/public/availability", { json(slots) })
    }

    private fun HttpRequestData.text() = (body as TextContent).text

    @Test
    fun a_single_doctor_is_chosen_and_their_slots_load() =
        runTest {
            val backend = FakeBackend().apply { serve() }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.write"))
            val holder = BookingStateHolder(clinic, "p1", day, this)
            val s = holder.state.first { it.slots.isNotEmpty() }
            assertEquals("d1", s.doctorId)
            assertEquals(listOf("Chair 1"), s.chairs.map { it.label })
            assertEquals(listOf(LocalTime(10, 0), LocalTime(10, 30)), s.slots.map { it.time })
            assertEquals(30, s.slotMinutes)
            val q =
                backend.requests
                    .last { it.url.encodedPath == "/api/v1/public/availability" }
                    .url.parameters
            assertEquals("2026-10-09", q["date"])
            assertEquals("d1", q["practitioner_id"])
            assertFalse(s.canBook)
        }

    @Test
    fun booking_sends_the_slot_and_chair_and_keeps_warnings() =
        runTest {
            val backend = FakeBackend().apply { serve() }
            backend.on("$SUNRISE/api/v1/appointments", { json(saved, HttpStatusCode.Created) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.write"))
            val holder = BookingStateHolder(clinic, "p1", day, this)
            val s = holder.state.first { it.slots.isNotEmpty() }
            holder.chooseSlot(s.slots[0])
            holder.chooseChair("r1")
            holder.chooseKind(VisitKind.Procedure)
            holder.setReason("  RCT  ")
            assertTrue(holder.state.value.canBook)
            holder.book()
            val done = holder.state.first { it.booked != null }
            assertEquals("7", done.booked)
            assertEquals(listOf(BookingWarningKind.OutsideWorkingHours), done.warnings)
            val body = backend.requests.last { it.url.encodedPath == "/api/v1/appointments" }.text()
            assertTrue(""""starts_at":"2026-10-09T04:30:00Z"""" in body, body)
            assertTrue(""""ends_at":"2026-10-09T05:00:00Z"""" in body, body)
            assertTrue(
                """"room_id":"r1"""" in body && """"kind":"procedure"""" in body && """"reason":"RCT"""" in body,
                body,
            )
            assertFalse(holder.state.value.canBook, "a booked sheet cannot book again")
        }

    @Test
    fun a_taken_slot_shows_the_error_and_reloads_slots() =
        runTest {
            val backend = FakeBackend().apply { serve() }
            backend.on("$SUNRISE/api/v1/appointments", { apiError(HttpStatusCode.Conflict, "conflict") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.write"))
            val holder = BookingStateHolder(clinic, "p1", day, this)
            holder.chooseSlot(holder.state.first { it.slots.isNotEmpty() }.slots[1])
            holder.book()
            val failed = holder.state.first { it.error != null && !it.saving }
            assertNull(failed.booked)
            assertTrue(failed.error is ScreenError)
            holder.state.first { !it.loadingSlots }
            assertEquals(2, backend.count("$SUNRISE/api/v1/public/availability"))
        }

    @Test
    fun without_appointments_write_nothing_loads() =
        runTest {
            val backend = FakeBackend().apply { serve() }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = BookingStateHolder(clinic, "p1", day, this)
            assertFalse(holder.state.value.allowed)
            assertEquals(0, backend.count("$SUNRISE/api/v1/practitioners"))
        }
}
