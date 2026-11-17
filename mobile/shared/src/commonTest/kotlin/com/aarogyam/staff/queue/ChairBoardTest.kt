package com.aarogyam.staff.queue

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import io.ktor.client.engine.mock.toByteArray
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChairBoardTest {
    private val rooms =
        """{"items":[
          {"id":"c2","branch_id":"b1","name":"Chair 2","kind":"chair","active":true,"sort_order":2},
          {"id":"c1","branch_id":"b1","name":"Chair 1","kind":"chair","active":true,"sort_order":1},
          {"id":"x1","branch_id":"b1","name":"X-ray","kind":"room","active":true,"sort_order":3},
          {"id":"c9","branch_id":"b1","name":"Old chair","kind":"chair","active":false,"sort_order":4},
          {"id":"c5","branch_id":"b2","name":"Other branch","kind":"chair","active":true,"sort_order":5}]}"""

    private fun row(
        id: String,
        status: TokenStatus,
        room: String? = null,
    ) = QueueRow(
        id,
        1,
        "p$id",
        "Patient $id",
        "SD-$id",
        null,
        Sex.Unknown,
        status,
        0,
        null,
        branchId = "b1",
        roomId = room,
    )

    private val chairs =
        listOf(QueueChair("c1", "Chair 1", "b1"), QueueChair("c2", "Chair 2", "b1"), QueueChair("c5", "Far", "b2"))

    @Test
    fun each_chair_of_the_queues_branch_shows_its_patient_and_loose_seats_follow() {
        val board =
            chairBoard(
                listOf(
                    row("a", TokenStatus.InChair, "c2"),
                    row("b", TokenStatus.InChair),
                    row("c", TokenStatus.Waiting),
                ),
                chairs,
            )
        assertEquals(listOf("c1", "c2", null), board.map { it.chair?.id })
        assertEquals(listOf(null, "a", "b"), board.map { it.occupant?.id })
        assertEquals("c1", freeChairFor(row("c", TokenStatus.Waiting), board)?.id)
    }

    @Test
    fun a_clinic_without_chairs_still_offers_one_seat_while_somebody_waits() {
        assertEquals(listOf(ChairSlot(null, null)), chairBoard(listOf(row("c", TokenStatus.Waiting)), emptyList()))
        assertTrue(chairBoard(listOf(row("d", TokenStatus.Done)), emptyList()).isEmpty())
    }

    @Test
    fun seating_sends_the_first_free_chair_and_seat_next_fills_the_chosen_one() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/queue",
                {
                    json(
                        """{"date":"2026-10-08","items":[${tokenJson("t1", 1, "in_chair", "p1", "A", room = "c1")},
                           ${tokenJson("t2", 2, "waiting", "p2", "B")},${tokenJson("t3", 3, "waiting", "p3", "C")}]}""",
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/rooms", { json(rooms) })
            backend.on(
                "$SUNRISE/api/v1/queue/t2/status",
                { json(tokenJson("t2", 2, "in_chair", "p2", "B", room = "c2")) },
            )
            backend.on(
                "$SUNRISE/api/v1/queue/t3/status",
                { json(tokenJson("t3", 3, "in_chair", "p3", "C", room = "c2")) },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read", "appointments.write"))
            val holder = graph.queue(clinic, backgroundScope)
            val loaded = holder.state.first { it is QueueState.Loaded && it.chairs.isNotEmpty() } as QueueState.Loaded
            assertEquals(listOf("Chair 1", "Chair 2"), loaded.board.mapNotNull { it.chair?.name })
            holder.seat("t2")
            holder.state.first {
                (it as? QueueState.Loaded)?.rows?.any { r ->
                    r.id == "t2" && r.roomId == "c2"
                } == true
            }
            val first = backend.requests.last { it.url.encodedPath == "/api/v1/queue/t2/status" }
            val body = first.body.toByteArray().decodeToString()
            assertTrue(""""status":"in_chair"""" in body && """"room_id":"c2"""" in body, body)
            holder.seatNextIn("c2")
            holder.state.first {
                (it as? QueueState.Loaded)?.rows?.any { r ->
                    r.id == "t3" &&
                        r.status == TokenStatus.InChair
                } ==
                    true
            }
            val next = backend.requests.last { it.url.encodedPath == "/api/v1/queue/t3/status" }
            assertTrue(""""room_id":"c2"""" in next.body.toByteArray().decodeToString())
        }

    @Test
    fun no_shows_come_from_the_days_counts_and_stay_null_when_they_cant_be_read() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/queue", { json("""{"date":"2026-10-08","items":[${tokenJson("t1", 1)}]}""") })
            backend.on("$SUNRISE/api/v1/today", {
                json(
                    com.aarogyam.staff
                        .todayBody()
                        .replace("\"no_shows\":0", "\"no_shows\":2"),
                )
            })
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.queue(openClinic(backend, graph, this, listOf("appointments.read")), backgroundScope)
            assertEquals(2, (holder.state.first { it is QueueState.Loaded } as QueueState.Loaded).noShows)

            val quiet = FakeBackend()
            quiet.on("$SUNRISE/api/v1/queue", { json("""{"date":"2026-10-08","items":[]}""") })
            val g2 = testGraph(quiet, backgroundScope)
            val h2 = g2.queue(openClinic(quiet, g2, this, listOf("appointments.read")), backgroundScope)
            assertEquals(null, (h2.state.first { it is QueueState.Loaded } as QueueState.Loaded).noShows)
        }
}
