package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.model.QueueToken
import com.aarogyam.staff.api.model.TodayResponse
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.TimeZone
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

private val wire = Json { ignoreUnknownKeys = true }

private fun member(
    id: String,
    shifts: List<Pair<String, String>> = listOf("09:00" to "13:00"),
    leave: Boolean = false,
) = """{"practitioner":{"id":"$id","display_name":"Dr $id","calendar_color":null},
    "shifts":${shifts.joinToString(",", "[", "]") { """{"starts":"${it.first}","ends":"${it.second}"}""" }},
    "on_leave":$leave,"appointments":0}"""

private fun chair(
    id: String,
    current: Boolean = false,
) = """{"room_id":"$id","name":"Chair $id","kind":"chair","status":"${if (current) "in_use" else "free"}",
    "current":${if (current) {
    """{"appointment_id":"a1","starts_at":"2026-10-05T03:30:00Z","ends_at":"2026-10-05T04:00:00Z","status":"in_chair",
        "patient":{"id":"p1","number":"SD-1","full_name":"A","sex":"female","registration_incomplete":false},
        "practitioner":{"id":"d1","display_name":"Dr d1","calendar_color":null}}"""
} else {
    "null"
}},"next":null}"""

private fun todayJson(
    team: List<String>,
    chairs: List<String>,
) = """{"date":"2026-10-05","as_of":"2026-10-05T04:15:00Z","appointments":[],
    "counts":{"total":0,"booked":0,"arrived":0,"in_chair":0,"done":0,"no_shows":0,"cancelled":0,"waiting":0,"called":0,"ready_to_bill":0},
    "by_hour":[],"chairs":${chairs.joinToString(",", "[", "]")},"recent_patients":[],
    "team":${team.joinToString(",", "[", "]")},"attention":[],"completed_visits":[]}"""

private fun token(
    id: String,
    status: String,
    doctor: String? = "d1",
    room: String? = null,
) = """{"id":"$id","branch_id":"b1","day":"2026-10-05","token_number":1,"status":"$status",
    "issued_at":"2026-10-05T04:00:00Z","wait_minutes":3,"room_id":${room?.let { "\"$it\"" }},
    "patient":{"id":"p$id","number":"SD-1","full_name":"A","sex":"female","registration_incomplete":false},
    "practitioner":${doctor?.let { """{"id":"$it","display_name":"Dr $it","calendar_color":null}""" }}}"""

private fun strip(
    team: List<String> = listOf(member("d1")),
    chairs: List<String> = listOf(chair("r1"), chair("r2")),
    tokens: List<String> = emptyList(),
    minute: Int = 10 * 60,
): AvailabilityStrip =
    availabilityOf(
        wire.decodeFromString<TodayResponse>(todayJson(team, chairs)),
        tokens.map { wire.decodeFromString<QueueToken>(it) },
        minute,
    )

class AvailabilityTest {
    private fun doctor(s: AvailabilityStrip) = s.doctors.single().availability

    @Test
    fun a_doctor_on_shift_with_no_token_is_free() = assertEquals(DoctorAvailability.Free, doctor(strip()))

    @Test
    fun shift_start_is_inclusive_and_end_is_exclusive() {
        assertEquals(DoctorAvailability.Away, doctor(strip(minute = 9 * 60 - 1)))
        assertEquals(DoctorAvailability.Free, doctor(strip(minute = 9 * 60)))
        assertEquals(DoctorAvailability.Free, doctor(strip(minute = 13 * 60 - 1)))
        assertEquals(DoctorAvailability.Away, doctor(strip(minute = 13 * 60)))
    }

    @Test
    fun a_split_shift_is_away_in_the_gap() {
        val team = listOf(member("d1", listOf("09:00" to "13:00", "16:00" to "20:00")))
        assertEquals(DoctorAvailability.Away, doctor(strip(team, minute = 14 * 60)))
        assertEquals(DoctorAvailability.Free, doctor(strip(team, minute = 17 * 60)))
    }

    @Test
    fun no_shift_today_or_leave_is_away() {
        assertEquals(DoctorAvailability.Away, doctor(strip(listOf(member("d1", shifts = emptyList())))))
        assertEquals(DoctorAvailability.Away, doctor(strip(listOf(member("d1", leave = true)))))
    }

    @Test
    fun called_or_in_chair_is_with_patient_and_waiting_or_done_is_not() {
        listOf("called", "in_chair").forEach {
            val slot = strip(tokens = listOf(token("1", it))).doctors.single()
            assertEquals(DoctorAvailability.WithPatient, slot.availability, it)
            assertEquals(1, slot.patients)
        }
        listOf("waiting", "ready_to_bill", "done", "left").forEach {
            assertEquals(DoctorAvailability.Free, doctor(strip(tokens = listOf(token("1", it)))), it)
        }
    }

    @Test
    fun a_token_for_another_doctor_or_none_does_not_mark_this_one() {
        val tokens = listOf(token("1", "in_chair", doctor = "d2"), token("2", "in_chair", doctor = null))
        assertEquals(DoctorAvailability.Free, doctor(strip(tokens = tokens)))
    }

    @Test
    fun a_patient_in_the_chair_beats_leave_and_end_of_shift() {
        val tokens = listOf(token("1", "in_chair"))
        assertEquals(DoctorAvailability.WithPatient, doctor(strip(listOf(member("d1", leave = true)), tokens = tokens)))
        assertEquals(DoctorAvailability.WithPatient, doctor(strip(tokens = tokens, minute = 14 * 60)))
    }

    @Test
    fun a_chair_is_busy_only_with_a_room_id_or_a_current_appointment() {
        val s =
            strip(
                chairs = listOf(chair("r1"), chair("r2"), chair("r3", current = true)),
                tokens = listOf(token("1", "in_chair", room = "r2"), token("2", "in_chair", room = null)),
            )
        assertEquals(
            listOf(ChairAvailability.Free, ChairAvailability.Busy, ChairAvailability.Busy),
            s.chairs.map { it.availability },
        )
        assertEquals(1, s.freeChairs)
    }

    @Test
    fun a_walk_in_with_no_room_marks_no_chair() {
        val s = strip(tokens = listOf(token("1", "waiting", room = null), token("2", "called", room = null)))
        assertEquals(2, s.freeChairs)
    }

    @Test
    fun two_tokens_in_one_chair_is_one_busy_chair() {
        val s = strip(tokens = listOf(token("1", "in_chair", room = "r1"), token("2", "called", room = "r1")))
        assertEquals(ChairAvailability.Busy, s.chairs[0].availability)
        assertEquals(2, s.chairs[0].tokens)
        assertEquals(1, s.freeChairs)
    }

    @Test
    fun finished_tokens_free_the_chair_and_unknown_rooms_are_ignored() {
        val tokens =
            listOf(
                token("1", "done", room = "r1"),
                token("2", "ready_to_bill", room = "r1"),
                token("3", "left", room = "r1"),
                token("4", "in_chair", room = "r-gone"),
            )
        assertEquals(2, strip(tokens = tokens).freeChairs)
    }

    @Test
    fun as_of_is_read_in_the_clinic_zone() {
        assertEquals(9 * 60 + 45, minuteOfDay("2026-10-05T04:15:00Z", TimeZone.of("Asia/Kolkata")))
        assertNull(minuteOfDay("garbage", TimeZone.UTC))
    }

    @Test
    fun the_holder_folds_today_and_queue_without_a_new_call() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayJson(listOf(member("d1")), listOf(chair("r1")))) })
            backend.on(
                "$SUNRISE/api/v1/queue",
                { json("""{"date":"2026-10-05","items":[${token("1", "in_chair", room = "r1")}]}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = graph.availability(clinic, backgroundScope)
            val loaded = assertIs<AvailabilityState.Loaded>(holder.state.first { it is AvailabilityState.Loaded })
            assertEquals(
                DoctorAvailability.WithPatient,
                loaded.strip.doctors
                    .single()
                    .availability,
            )
            assertEquals(
                ChairAvailability.Busy,
                loaded.strip.chairs
                    .single()
                    .availability,
            )
        }

    @Test
    fun without_appointments_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("queue.write"))
            val holder = graph.availability(clinic, backgroundScope)
            holder.refresh()
            assertEquals(AvailabilityState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/today"))
        }
}
