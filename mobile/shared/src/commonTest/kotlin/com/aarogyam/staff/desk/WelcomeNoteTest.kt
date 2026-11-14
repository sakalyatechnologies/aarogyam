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
import kotlin.test.assertNull

class WelcomeNoteTest {
    @Test
    fun only_a_welcome_that_did_not_go_out_gets_a_note() {
        assertNull(welcomeNote(null, null))
        assertNull(welcomeNote("queued", null))
        assertNull(welcomeNote("sent", null))
        assertEquals(WelcomeNote.Failed, welcomeNote("failed", null))
        assertEquals(WelcomeNote.NoConsent, welcomeNote("skipped", "no_consent"))
        assertEquals(WelcomeNote.NoConsent, welcomeNote("skipped", "consent_withdrawn"))
        assertEquals(WelcomeNote.OptedOut, welcomeNote("skipped", "opted_out"))
        assertEquals(WelcomeNote.NoAddress, welcomeNote("skipped", "no_address"))
        assertEquals(WelcomeNote.Skipped, welcomeNote("skipped", "unsupported"))
        assertEquals(WelcomeNote.Skipped, welcomeNote("skipped", null))
    }

    @Test
    fun the_board_carries_each_token_s_welcome_note() =
        runTest {
            val backend = FakeBackend()
            val skipped =
                tokenJson().dropLast(1) + ""","welcome_status":"skipped","welcome_skip_reason":"no_address"}"""
            val sent = tokenJson(id = "t2", number = 8).dropLast(1) + ""","welcome_status":"sent"}"""
            backend.on("$SUNRISE/api/v1/queue", { json("""{"date":"2026-10-08","items":[$skipped,$sent]}""") })
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("appointments.read"))
            val board = DeskBoardStateHolder(clinic, backgroundScope)
            val loaded = board.state.first { it is DeskBoardState.Loaded } as DeskBoardState.Loaded
            assertEquals(listOf(WelcomeNote.NoAddress, null), loaded.tickets.map { it.welcome })
        }
}
