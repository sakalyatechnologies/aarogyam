package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.engine.mock.toByteArray
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class WalkInStateHolderTest {
    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = DESK,
        logs: MemoryLogSink = MemoryLogSink(),
    ): WalkInStateHolder {
        backend.on(DOCTORS, { json(DOCTORS_JSON) })
        backend.on(PICKS, { json(PICKS_JSON) })
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.walkIn(clinic, backgroundScope)
    }

    private fun WalkInStateHolder.form() = assertIs<WalkInState.Editing>(state.value).form

    private suspend fun WalkInStateHolder.awaitForm(until: (WalkInForm) -> Boolean): WalkInForm =
        (state.first { it is WalkInState.Editing && until(it.form) } as WalkInState.Editing).form

    @Test
    fun a_role_without_intake_write_is_not_allowed_and_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("patients.read", "patients.write"))
            assertEquals(WalkInState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(DOCTORS))
        }

    @Test
    fun opening_loads_active_doctors_and_allergy_chips_once() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            holder.awaitForm { it.allergyPicks.isNotEmpty() }
            assertEquals(listOf(DoctorOption("d1", "Dr. Patil")), holder.form().doctors)
            assertEquals(listOf("Penicillin", "Latex"), holder.form().allergyPicks)
            assertEquals(1, backend.count(PICKS))
        }

    @Test
    fun a_complete_mobile_looks_up_once_with_the_phone_in_the_body() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            val holder = holder(backend)
            "+91 98765 43210".indices.forEach { holder.setMobile("+91 98765 43210".take(it + 1)) }
            holder.awaitForm { it.lookup is LookupState.Matches }
            assertEquals("9876543210", holder.form().mobile)
            val lookup = assertIs<LookupState.Matches>(holder.form().lookup)
            assertEquals("Meera Shah", lookup.items.single().name)
            assertEquals(1, backend.count(LOOKUP))
            val request = backend.requests.last { it.url.encodedPath.endsWith("lookup") }
            assertTrue(request.url.encodedQuery.isEmpty())
            assertEquals("""{"phone":"+919876543210"}""", request.body.toByteArray().decodeToString())
        }

    @Test
    fun a_number_with_matches_needs_a_pick_or_someone_new() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            val holder = holder(backend)
            holder.setMobile("9876543210")
            holder.awaitForm { it.lookup is LookupState.Matches }
            holder.submit()
            assertEquals(WalkInProblem.PickPatient, holder.form().problem)
            assertEquals(0, backend.count(WALK_INS))
            holder.someoneNew()
            holder.submit()
            assertEquals(WalkInProblem.NameRequired, holder.form().problem)
            holder.setName("Ravi Kulkarni")
            holder.setAge("400")
            holder.submit()
            assertEquals(WalkInProblem.AgeInvalid, holder.form().problem)
        }
}
