package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.LOOKUP
import com.aarogyam.staff.walkin.MATCHES_JSON
import com.aarogyam.staff.walkin.WALK_INS
import com.aarogyam.staff.walkin.tokenJson
import com.aarogyam.staff.walkin.walkInJson
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.engine.mock.toByteArray
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class DeskLookupStateHolderTest {
    private val queue = "$SUNRISE/api/v1/queue"
    private val perms = listOf("patients.read", "appointments.read", "appointments.write", "intake.write")
    private val phone = "+919876543210"

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = perms,
        logs: MemoryLogSink = MemoryLogSink(),
    ): DeskLookupStateHolder {
        backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson()}]}""") })
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.desk(clinic, backgroundScope)
    }

    private suspend fun DeskLookupStateHolder.settled() =
        state.first {
            it !is DeskLookupState.Idle &&
                it !is DeskLookupState.Looking
        }

    @Test
    fun one_match_checked_in_today_offers_no_check_in() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            val holder = holder(backend)
            "+91 98765 43210".indices.forEach { holder.search("+91 98765 43210".take(it + 1)) }
            val matches = assertIs<DeskLookupState.Matches>(holder.settled())
            val meera = matches.profiles.single()
            assertEquals("MS", meera.initials)
            assertEquals(34, meera.ageYears)
            assertTrue(meera.checkedInToday)
            assertEquals(PatientState.Waiting, meera.state)
            assertEquals(null, meera.lastVisit)
            assertEquals(listOf(DeskAction.AddFamilyMember(phone), DeskAction.NewPatient(phone)), matches.actions)
            assertEquals(1, backend.count(LOOKUP))
            val body =
                backend.requests
                    .last {
                        it.url.encodedPath.endsWith(
                            "lookup",
                        )
                    }.body
                    .toByteArray()
                    .decodeToString()
            assertEquals("""{"phone":"$phone"}""", body)
        }

    @Test
    fun many_matches_offer_check_in_for_those_not_in_today() =
        runTest {
            val backend = FakeBackend()
            val two = MATCHES_JSON.replace("]}", ",$SECOND]}")
            backend.on(LOOKUP, { json(two) })
            val holder = holder(backend)
            holder.search("9876543210")
            val matches = assertIs<DeskLookupState.Matches>(holder.settled())
            assertEquals(2, matches.profiles.size)
            assertFalse(matches.profiles[1].checkedInToday)
            assertEquals(DeskAction.CheckIn("p2"), matches.actions.first())
        }

    @Test
    fun no_match_offers_only_a_new_patient() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json("""{"items":[],"family_group":[]}""") })
            val holder = holder(backend)
            holder.search("09876543210")
            val none = assertIs<DeskLookupState.NoMatch>(holder.settled())
            assertEquals(listOf<DeskAction>(DeskAction.NewPatient(phone)), none.actions)
        }

    @Test
    fun offline_is_a_failed_state() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { throw kotlinx.io.IOException("down") })
            val holder = holder(backend)
            holder.search("9876543210")
            val failed = assertIs<DeskLookupState.Failed>(holder.settled())
            assertTrue(failed.error == ScreenError.Offline || failed.error == ScreenError.Network)
        }

    @Test
    fun a_role_without_permissions_is_not_allowed_and_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("patients.read"))
            holder.search("9876543210")
            assertEquals(DeskLookupState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(LOOKUP))
        }

    @Test
    fun check_in_posts_the_existing_patient_and_logs_no_phone() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            backend.on(WALK_INS, { json(walkInJson(registered = false)) })
            val logs = MemoryLogSink()
            val holder = holder(backend, logs = logs)
            holder.search("9876543210")
            holder.settled()
            holder.checkIn("p1")
            val done = assertIs<DeskLookupState.CheckedIn>(holder.state.first { it is DeskLookupState.CheckedIn })
            assertEquals(7, done.tokenNumber)
            val sent =
                backend.requests
                    .last {
                        it.url.encodedPath.endsWith(
                            "walk-ins",
                        )
                    }.body
                    .toByteArray()
                    .decodeToString()
            assertTrue("\"patient_id\":\"p1\"" in sent)
            assertFalse(logs.records.any { "9876543210" in it.toString() })
        }

    private companion object {
        const val SECOND =
            """{"id":"p2","number":"SD-1043","full_name":"Arjun Shah","sex":"male","registration_incomplete":false,"age_years":9}"""
    }
}
