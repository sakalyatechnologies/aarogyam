package com.aarogyam.staff.signin

import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.auth.SessionState
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DeleteAccountHolderTest {
    private val route = "$DEMO_APP/api/v1/me/account"

    @Test
    fun a_deleted_account_signs_the_device_out_without_telling_supabase() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { respond("", HttpStatusCode.NoContent) })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.deleteAccount(this)
            assertEquals(DeleteAccountState.Idle, holder.state.value)
            holder.delete()
            holder.state.first { it == DeleteAccountState.Deleted }
            graph.sessionState.first { it is SessionState.SignedOut }
            val sent = backend.requests.single { it.url.encodedPath == "/api/v1/me/account" }
            assertEquals(HttpMethod.Delete, sent.method)
            assertEquals(
                "application/json",
                sent.body.contentType
                    ?.withoutParameters()
                    ?.toString(),
            )
            assertEquals("""{"confirm":"delete"}""", sent.body.toByteArray().decodeToString())
            assertTrue(backend.requests.none { it.url.encodedPath == "/auth/v1/logout" })
        }

    @Test
    fun the_only_owner_sees_the_clinics_and_stays_signed_in() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        """{"error":{"code":"last_owner","message":"x"},"clinics":[{"id":"c1","name":"Lotus Clinic"},{"id":"c2","name":"Sunrise Dental"}]}""",
                        HttpStatusCode.Conflict,
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.deleteAccount(this)
            holder.delete()
            val state = holder.state.first { it !is DeleteAccountState.Idle && it !is DeleteAccountState.Deleting }
            assertEquals(DeleteAccountState.LastOwner(listOf("Lotus Clinic", "Sunrise Dental")), state)
            assertTrue(graph.sessionState.value is SessionState.SignedIn)
            holder.reset()
            assertEquals(DeleteAccountState.Idle, holder.state.value)
        }

    @Test
    fun platform_staff_is_refused() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.Conflict, "platform_staff") })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.deleteAccount(this)
            holder.delete()
            assertEquals(
                DeleteAccountState.PlatformStaff,
                holder.state.first { it is DeleteAccountState.PlatformStaff },
            )
            assertTrue(graph.sessionState.value is SessionState.SignedIn)
        }

    @Test
    fun a_sign_in_without_a_staff_profile_is_told_so() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotFound, "no_staff_account") })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.deleteAccount(backgroundScope)
            holder.delete()
            assertEquals(
                DeleteAccountState.NotStaff,
                holder.state.first {
                    it !is DeleteAccountState.Idle &&
                        it !is DeleteAccountState.Deleting
                },
            )
            assertTrue(graph.sessionState.value is SessionState.SignedIn)
        }

    @Test
    fun a_refused_request_fails_and_can_be_retried() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
                { respond("", HttpStatusCode.NoContent) },
            )
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.deleteAccount(this)
            holder.delete()
            assertEquals(
                DeleteAccountState.Failed(ScreenError.NotAllowed),
                holder.state.first { it is DeleteAccountState.Failed },
            )
            holder.delete()
            holder.state.first { it == DeleteAccountState.Deleted }
            assertEquals(2, backend.count(route))
        }
}
