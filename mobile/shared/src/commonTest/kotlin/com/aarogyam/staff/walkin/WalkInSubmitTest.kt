package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class WalkInSubmitTest {
    private val logs = MemoryLogSink()

    private suspend fun TestScope.holder(backend: FakeBackend): WalkInStateHolder {
        backend.on(DOCTORS, { json(DOCTORS_JSON) })
        backend.on(PICKS, { json(PICKS_JSON) })
        val graph = testGraph(backend, backgroundScope, logs = logs)
        return graph.walkIn(openClinic(backend, graph, this, DESK), backgroundScope)
    }

    private suspend fun FakeBackend.sentBody(): String =
        requests
            .last { it.url.encodedPath.endsWith("walk-ins") }
            .body
            .toByteArray()
            .decodeToString()

    @Test
    fun a_new_patient_is_registered_and_queued_in_one_request() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.setMobile("9876543210")
            holder.someoneNew()
            holder.setName(" Ravi Kulkarni ")
            holder.setAge("40")
            holder.setSex(Sex.Male)
            holder.toggleAllergy("Penicillin")
            holder.setDoctor("d1")
            holder.submit()
            holder.submit() // a double tap sends nothing more
            holder.state.first { it is WalkInState.Done }
            assertEquals(WalkInState.Done("Ravi Kulkarni", 7, registered = true), holder.state.value)
            assertEquals(1, backend.count(WALK_INS))
            val body = backend.sentBody()
            assertTrue(""""full_name":"Ravi Kulkarni"""" in body)
            assertTrue(""""phone":"+919876543210"""" in body)
            assertTrue(""""allergies":["Penicillin"]""" in body)
            assertTrue(""""purpose":"care"""" in body && """"purpose":"reminders"""" in body)
            assertTrue(""""practitioner_id":"d1"""" in body)
            assertFalse("patient_id" in body)
            val logged = logs.records.joinToString { it.format() }
            assertFalse("Ravi" in logged || "98765" in logged, "no patient data in logs")
        }

    @Test
    fun a_picked_patient_with_no_known_allergies_sends_only_the_id() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            backend.on(WALK_INS, { json(walkInJson(registered = false), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.setMobile("9876543210")
            holder.state.first { it is WalkInState.Editing && it.form.lookup is LookupState.Matches }
            val match =
                assertIs<LookupState.Matches>(
                    assertIs<WalkInState.Editing>(holder.state.value).form.lookup,
                ).items[0]
            holder.pick(match)
            holder.toggleAllergy("Latex")
            holder.toggleNoKnownAllergies()
            holder.setReminders(false)
            holder.submit()
            holder.state.first { it is WalkInState.Done }
            val body = backend.sentBody()
            assertTrue(""""patient_id":"p1"""" in body && """"no_known_allergies":true""" in body)
            assertFalse("\"patient\":" in body || "allergies\":[" in body || "reminders" in body)
        }

    @Test
    fun a_failure_keeps_the_form_and_says_why() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val holder = holder(backend)
            holder.setName("Ravi Kulkarni")
            holder.submit()
            holder.state.first { it is WalkInState.Editing && it.form.error != null }
            val form = assertIs<WalkInState.Editing>(holder.state.value).form
            assertEquals(ScreenError.NotAllowed, form.error)
            assertFalse(form.submitting)
            assertEquals("Ravi Kulkarni", form.name)
            holder.startAnother()
            assertEquals("", assertIs<WalkInState.Editing>(holder.state.value).form.name)
        }
}
