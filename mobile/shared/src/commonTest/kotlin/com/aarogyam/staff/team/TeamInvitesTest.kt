package com.aarogyam.staff.team

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TeamInvitesTest {
    private fun staff(vararg invites: String) =
        """{"members":[{"id":"m1","user_id":"u1","display_name":"Dr Dev Rao","role_key":"doctor","role_name":"Doctor",
             "status":"active","branches":[]}],
           "invitations":[${invites.joinToString(",")}]}"""

    private fun invite(
        id: String,
        role: String,
        expires: String = "2026-11-24T00:00:00Z",
    ) =
        """{"id":"$id","email":"$id@example.test","role_key":"$role","created_at":"2026-11-17T00:00:00Z","expires_at":"$expires"}"""

    @Test
    fun a_resend_reports_the_email_and_reloads_the_new_expiry() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/staff",
                { json(staff(invite("i1", "front_desk"), invite("i2", "owner"))) },
                { json(staff(invite("i1", "front_desk", "2026-11-25T00:00:00Z"), invite("i2", "owner"))) },
            )
            backend.on(
                "$SUNRISE/api/v1/staff/invitations/i1/resend",
                {
                    json(
                        """{"id":"i1","email":"i1@example.test","role_key":"front_desk",
                           "expires_at":"2026-11-25T00:00:00Z","invite_token":"secret"}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.team(openClinic(backend, graph, this, listOf("staff.manage")), backgroundScope)
            val rows = holder.pending.first { it.size == 2 }
            assertTrue(rows.first { it.id == "i1" }.manageable)
            assertFalse(rows.first { it.id == "i2" }.manageable, "a doctor cannot act on an owner's invitation")
            holder.cancel("i2")
            assertEquals(0, backend.count("$SUNRISE/api/v1/staff/invitations/i2"), "nothing is sent for it")
            holder.resend("i1")
            assertEquals(InviteNotice.Resent("i1@example.test"), holder.notice.first { it != null })
            holder.pending.first { rows -> rows.any { it.expires?.date?.day == 25 } }
            assertNull(holder.busy.value)
            holder.consumeNotice()
            assertNull(holder.notice.value)
        }

    @Test
    fun a_cancel_drops_the_row_and_a_refusal_keeps_it() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/staff", { json(staff(invite("i1", "front_desk"), invite("i3", "doctor"))) })
            backend.on(
                "$SUNRISE/api/v1/staff/invitations/i1",
                { respond("", HttpStatusCode.NoContent) },
            )
            backend.on(
                "$SUNRISE/api/v1/staff/invitations/i3",
                { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.team(openClinic(backend, graph, this, listOf("staff.manage")), backgroundScope)
            holder.pending.first { it.size == 2 }
            holder.cancel("i1")
            assertEquals(InviteNotice.Cancelled, holder.notice.first { it != null })
            assertEquals(listOf("i3"), holder.pending.value.map { it.id })
            assertEquals(HttpMethod.Delete, backend.requests.last { it.url.encodedPath.endsWith("/i1") }.method)
            holder.consumeNotice()
            holder.cancel("i3")
            assertEquals(InviteNotice.Failed(ScreenError.Server), holder.notice.first { it != null })
            assertEquals(listOf("i3"), holder.pending.value.map { it.id })
        }
}
