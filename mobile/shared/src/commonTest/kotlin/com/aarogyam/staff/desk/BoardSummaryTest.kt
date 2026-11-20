package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class BoardSummaryTest {
    @Test
    fun only_a_done_card_with_a_visit_offers_the_whatsapp_summary() =
        runTest {
            val backend = FakeBackend()
            val done = tokenJson(status = "done").dropLast(1) + ""","visit_id":"v1"}"""
            val doneNoVisit = tokenJson(id = "t2", number = 8, status = "done").dropLast(1) + ""","visit_id":null}"""
            val waiting = tokenJson(id = "t3", number = 9).dropLast(1) + ""","visit_id":"v3"}"""
            backend.on(
                "$SUNRISE/api/v1/queue",
                { json("""{"date":"2026-10-08","items":[$done,$doneNoVisit,$waiting]}""") },
            )
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("appointments.read"))
            val board = DeskBoardStateHolder(clinic, backgroundScope)
            val loaded = board.state.first { it is DeskBoardState.Loaded } as DeskBoardState.Loaded
            assertEquals(listOf("v1", null, "v3"), loaded.tickets.map { it.visitId })
            assertEquals(listOf("v1", null, null), loaded.tickets.map { it.summaryVisitId })
        }
}
