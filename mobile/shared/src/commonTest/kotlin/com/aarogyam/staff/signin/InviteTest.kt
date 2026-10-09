package com.aarogyam.staff.signin

import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ME_TWO_CLINICS
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InviteTest {
    private val secret = "k3Yt0ken_abcdefghijklmnop-123"

    @Test
    fun links_from_the_email_and_the_app_scheme_parse() {
        assertEquals(secret, InviteLink.parse("https://sunrise.aarogyam.in/invite#$secret")?.value)
        assertEquals(secret, InviteLink.parse("  aarogyam://invite#$secret \n")?.value)
        assertEquals(secret, InviteLink.parse("https://sunrise.aarogyam.in/invite/#$secret")?.value)
        assertNull(InviteLink.parse("https://sunrise.aarogyam.in/invite?$secret"))
        assertNull(InviteLink.parse("https://sunrise.aarogyam.in/login#$secret"))
        assertNull(InviteLink.parse("aarogyam://invite#short"))
        assertNull(InviteLink.parse("aarogyam://invite#bad token with spaces"))
    }

    @Test
    fun the_token_never_prints() {
        val token = InviteLink.parse("aarogyam://invite#$secret")
        assertFalse(secret in token.toString())
    }

    @Test
    fun accepting_joins_and_refreshes_the_clinic_list_without_logging_the_token() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
            backend.on("$DEMO_APP/api/v1/invitations/accept", { json("""{"org_id":"o9","membership_id":"m9"}""") })
            val logs = MemoryLogSink()
            val graph = testGraph(backend, backgroundScope, logs = logs)
            signIn(graph, backend)
            val holder = graph.invite(this, "aarogyam://invite#$secret")
            assertEquals(InviteState.Ready, holder.state.value)
            holder.accept("  Asha  ")
            assertEquals(InviteState.Joined("o9"), holder.state.first { it is InviteState.Joined })
            val body =
                (
                    backend.requests
                        .last {
                            it.url.encodedPath == "/api/v1/invitations/accept"
                        }.body as TextContent
                ).text
            assertTrue(""""token":"$secret"""" in body && """"display_name":"Asha"""" in body, body)
            assertTrue(backend.count("$DEMO_APP/api/v1/me") >= 1)
            assertFalse(secret in logs.records.joinToString("\n") { it.format() }, "the token must not reach the logs")
            assertTrue(backend.requests.none { secret in it.url.toString() }, "the token must not be in a URL")
        }

    @Test
    fun a_refused_invitation_shows_why_and_a_bad_paste_is_flagged() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/invitations/accept", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.invite(this, null)
            assertEquals(InviteState.NeedsLink, holder.state.value)
            holder.useLink("hello")
            assertEquals(InviteState.BadLink, holder.state.value)
            holder.useLink("https://sunrise.aarogyam.in/invite#$secret")
            holder.accept(null)
            assertEquals(InviteState.Failed(ScreenError.NotAllowed), holder.state.first { it is InviteState.Failed })
        }

    @Test
    fun registration_checks_fields_then_sends_once() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/registrations", {
                json("""{"status":"received","message":"x"}""", HttpStatusCode.Created)
            })
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.registration(this)
            holder.send()
            assertEquals(
                setOf(
                    RegistrationField.ClinicName,
                    RegistrationField.City,
                    RegistrationField.ContactName,
                    RegistrationField.Email,
                ),
                holder.state.value.invalid,
            )
            holder.update {
                it.copy(
                    clinicName = "Smile Dental",
                    city = "Pune",
                    contactName = "Dr Rao",
                    email = "rao@example.in",
                    phone = "98",
                )
            }
            holder.send()
            assertEquals(setOf(RegistrationField.Phone), holder.state.value.invalid)
            holder.update { it.copy(phone = "+91 98200 00000") }
            holder.send()
            holder.state.first { it.received }
            holder.send()
            assertEquals(1, backend.count("$DEMO_APP/api/v1/registrations"))
        }
}
