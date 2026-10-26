package com.aarogyam.staff.nav

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HomeChoiceTest {
    @Test
    fun queue_call_is_doctor_home() {
        val choice = homeChoiceOf(setOf("queue.call", "appointments.read"))
        assertEquals(Home.Doctor, choice.home)
        assertFalse(choice.deskReachable)
    }

    @Test
    fun each_desk_key_without_queue_call_is_desk_home() {
        listOf("queue.write", "payments.collect", "billing.write").forEach {
            val choice = homeChoiceOf(setOf(it, "patients.read"))
            assertEquals(Home.Desk, choice.home, it)
            assertTrue(choice.deskReachable, it)
        }
    }

    @Test
    fun a_person_with_both_gets_doctor_home_and_desk_as_a_tab() {
        val choice = homeChoiceOf(setOf("queue.call", "queue.write", "billing.write"))
        assertEquals(Home.Doctor, choice.home)
        assertTrue(choice.deskReachable)
    }

    @Test
    fun anything_else_keeps_the_current_default() {
        listOf(emptySet(), setOf("finance.view", "appointments.read", "queue.read")).forEach {
            assertEquals(HomeChoice(Home.Default, deskReachable = false), homeChoiceOf(it))
        }
    }

    @Test
    fun the_doctor_home_resolves_the_members_practitioner_id() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/practitioners",
                {
                    json(
                        """{"items":[{"id":"d9","display_name":"Dr. Other","calendar_color":"#0E7490","active":true,"membership_id":"m2"},
                           {"id":"d1","display_name":"Dr. Patil","calendar_color":"#0E7490","active":true,"membership_id":"m1"}]}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("queue.call", "appointments.read"))
            val holder = graph.homeChoice(clinic, backgroundScope)
            assertEquals(Home.Doctor, holder.choice.value.home)
            assertEquals("d1", holder.choice.first { it.practitionerId != null }.practitionerId)
        }

    @Test
    fun a_desk_home_never_loads_doctors() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("queue.write"))
            val holder = graph.homeChoice(clinic, backgroundScope)
            assertEquals(Home.Desk, holder.choice.value.home)
            assertNull(holder.choice.value.practitionerId)
            assertEquals(0, backend.count("$SUNRISE/api/v1/practitioners"))
        }
}
