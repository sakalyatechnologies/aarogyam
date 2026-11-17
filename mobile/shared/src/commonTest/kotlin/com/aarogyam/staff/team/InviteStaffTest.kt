package com.aarogyam.staff.team

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InviteStaffTest {
    private val roles =
        """{"items":[
          {"id":"r1","key":"owner","name":"Owner","is_template":true,"permissions":[],"member_count":1},
          {"id":"r2","key":"doctor","name":"Doctor","is_template":true,"permissions":[],"member_count":2},
          {"id":"r3","key":"front_desk","name":"Front desk","is_template":true,"permissions":[],"member_count":0}]}"""

    @Test
    fun a_non_owner_picks_any_role_but_owner_and_the_invite_sends_email_and_role() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/roles", { json(roles) })
            backend.on(
                "$SUNRISE/api/v1/staff/invitations",
                {
                    json(
                        """{"id":"i1","email":"new@example.test","role_key":"front_desk",
                           "expires_at":"2026-11-24T00:00:00Z","invite_token":"secret"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("staff.manage"))
            val holder = graph.inviteStaff(clinic, backgroundScope)
            val loaded = holder.state.first { it.roles.isNotEmpty() }
            assertEquals(listOf("doctor", "front_desk"), loaded.roles.map { it.key })
            holder.setEmail("new@")
            assertTrue(holder.state.value.emailInvalid)
            assertFalse(holder.state.value.canSend)
            holder.setEmail(" new@example.test ")
            holder.chooseRole("front_desk")
            holder.setPhone("98765")
            assertTrue(holder.state.value.phoneInvalid)
            assertFalse(holder.state.value.canSend, "a bad phone blocks sending")
            holder.setPhone("+91 98765 43210")
            holder.setName("  Farah Shaikh  ")
            assertTrue(holder.state.value.canSend)
            holder.send()
            assertEquals("new@example.test", holder.state.first { it.sentTo != null }.sentTo)
            val body =
                (backend.requests.last { it.url.encodedPath == "/api/v1/staff/invitations" }.body as TextContent).text
            assertTrue(""""email":"new@example.test"""" in body && """"role_key":"front_desk"""" in body, body)
            assertTrue(""""display_name":"Farah Shaikh"""" in body && """"phone":"+919876543210"""" in body, body)
            assertFalse(holder.state.value.canSend, "a sent sheet cannot send again")
            holder.another()
            assertEquals("", holder.state.value.email)
            assertEquals("", holder.state.value.name + holder.state.value.phone)
            assertEquals("front_desk", holder.state.value.roleKey)
        }

    @Test
    fun a_refused_invite_shows_the_error_and_can_be_sent_again() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/roles", { json(roles) })
            backend.on(
                "$SUNRISE/api/v1/staff/invitations",
                { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.inviteStaff(openClinic(backend, graph, this, listOf("staff.manage")), backgroundScope)
            holder.state.first { it.roles.isNotEmpty() }
            holder.setEmail("new@example.test")
            holder.chooseRole("doctor")
            holder.send()
            val failed = holder.state.first { it.error != null }
            val sent =
                (backend.requests.last { it.url.encodedPath == "/api/v1/staff/invitations" }.body as TextContent)
                    .text
            assertFalse("display_name" in sent || "phone" in sent, sent)
            assertEquals(ScreenError.Server, failed.error)
            assertTrue(failed.canSend)
        }

    @Test
    fun without_staff_manage_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.inviteStaff(openClinic(backend, graph, this, listOf("patients.read")), backgroundScope)
            assertFalse(holder.state.value.allowed)
            assertEquals(0, backend.count("$SUNRISE/api/v1/roles"))
        }

    @Test
    fun pending_invitations_come_with_the_team_and_take_the_clinics_role_name() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/staff",
                {
                    json(
                        """{"members":[{"id":"m1","user_id":"u1","display_name":"Dr. Rao","role_key":"doctor",
                           "role_name":"Dentist","status":"active","branches":[]}],
                           "invitations":[{"id":"i1","email":"a@example.test","role_key":"doctor","display_name":" Dr. Iyer ",
                           "created_at":"2026-11-17T04:00:00Z","expires_at":"2026-11-24T04:00:00Z"},
                           {"id":"i2","role_key":"front_desk","created_at":"2026-11-17T04:00:00Z",
                           "expires_at":"2026-11-24T04:00:00Z"}]}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val team = graph.team(openClinic(backend, graph, this, listOf("staff.manage")), backgroundScope)
            team.state.first { it is ListState.Loaded }
            val pending = team.pending.value
            assertEquals(listOf("Dentist", "Front desk"), pending.map { it.roleName })
            assertEquals(listOf("a@example.test", null), pending.map { it.email })
            assertEquals(listOf("Dr. Iyer", null), pending.map { it.name })
        }
}
