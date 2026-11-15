package com.aarogyam.staff.notifications

import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.markNotificationRead
import com.aarogyam.staff.apiError
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.Outcome
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PushRegistrationTest {
    private val route = "$DEMO_APP/api/v1/me/devices"

    private suspend fun FakeBackend.waitFor(
        method: String,
        count: Int,
    ) = withContext(Dispatchers.Default) {
        withTimeout(5_000) {
            while (requests.count {
                    it.method.value == method &&
                        it.url.encodedPath.startsWith(
                            "/api/v1/me/devices/",
                        )
                } <
                count
            ) {
                delay(10)
            }
        }
    }

    private fun FakeBackend.devices() = requests.filter { it.url.encodedPath.startsWith("/api/v1/me/devices/") }

    @Test
    fun theInstallationIdIsMadeOnceAndKept() =
        runTest {
            val graph = testGraph(FakeBackend(), backgroundScope)
            val first = graph.push.installationId
            assertEquals(first, graph.push.installationId)
            assertEquals(first, graph.preferences.get(PreferenceKey.PushInstallationId))
            assertEquals(36, first.length)
        }

    @Test
    fun sendsTheTokenOnceSignedInAndAgainOnlyWhenItChanges() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val id = graph.push.installationId
            backend.on("$route/$id", { json("", HttpStatusCode.NoContent) })
            graph.push.setLocale("hi-IN")
            graph.push.setToken("AB12")
            delay(50)
            assertEquals(0, backend.devices().size, "nothing goes out while signed out")
            signIn(graph, backend)
            backend.waitFor("PUT", 1)
            val body =
                backend
                    .devices()
                    .single()
                    .body
                    .toByteArray()
                    .decodeToString()
            assertEquals(
                "PUT",
                backend
                    .devices()
                    .single()
                    .method.value,
            )
            assertTrue(
                """"platform":"ios"""" in body && """"token":"ab12"""" in body && """"app":"staff"""" in body,
                body,
            )
            assertTrue(""""locale":"hi"""" in body && """"app_version":"0.1.0"""" in body, body)
            graph.push.setToken("ab12")
            graph.push.setLocale("mr")
            backend.waitFor("PUT", 2)
            delay(50)
            assertEquals(2, backend.devices().size)
            assertTrue(
                """"locale":"mr"""" in
                    backend
                        .devices()
                        .last()
                        .body
                        .toByteArray()
                        .decodeToString(),
            )
            assertTrue(
                graph.preferences.get(PreferenceKey.PushSent)?.contains("ab12") != true,
                "the token is never stored",
            )
        }

    @Test
    fun signOutRevokesTheSessionAndTheNextSignInSendsTheSameTokenAgain() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val id = graph.push.installationId
            backend.on("$route/$id", { json("", HttpStatusCode.NoContent) })
            backend.on("$DEMO_APP/api/v1/me/sessions/revoke-current", { json("", HttpStatusCode.NoContent) })
            graph.push.setToken("ab12")
            signIn(graph, backend)
            backend.waitFor("PUT", 1)
            graph.signOut()
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    while (backend.requests.none {
                            it.url.encodedPath.endsWith(
                                "/me/sessions/revoke-current",
                            )
                        }
                    ) {
                        delay(10)
                    }
                }
            }
            signIn(graph, backend)
            backend.waitFor("PUT", 2)
        }

    @Test
    fun aFailedSendIsRetriedOnTheNextStart() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val id = graph.push.installationId
            backend.on("$route/$id", { apiError(HttpStatusCode.InternalServerError, "internal") })
            signIn(graph, backend)
            graph.push.setToken("cd34")
            backend.waitFor("PUT", 1)
            assertEquals(null, graph.preferences.get(PreferenceKey.PushSent))
            backend.on("$route/$id", { json("", HttpStatusCode.NoContent) })
            val again =
                PushRegistration(
                    graph.preferences,
                    kotlinx.coroutines.flow.flowOf(0),
                    graph.directory::appApi,
                    backgroundScope,
                    "0.1.0",
                )
            assertEquals(id, again.installationId)
            again.setToken("cd34")
            backend.waitFor("PUT", 2)
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    while (graph.preferences.get(PreferenceKey.PushSent) ==
                        null
                    ) {
                        delay(10)
                    }
                }
            }
            val before = backend.devices().size
            val third =
                PushRegistration(
                    graph.preferences,
                    kotlinx.coroutines.flow.flowOf(0),
                    graph.directory::appApi,
                    backgroundScope,
                    "0.1.0",
                )
            third.setToken("cd34")
            delay(100)
            assertEquals(before, backend.devices().size, "an accepted token is not sent again")
        }

    @Test
    fun forgetSendsTheDeleteAndClearsWhatWasAccepted() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val id = graph.push.installationId
            backend.on("$route/$id", { json("", HttpStatusCode.NoContent) })
            signIn(graph, backend)
            graph.push.setToken("ef56")
            backend.waitFor("PUT", 1)
            graph.push.forget()
            val delete = backend.devices().last()
            assertEquals("DELETE", delete.method.value)
            assertEquals("/api/v1/me/devices/$id", delete.url.encodedPath)
            assertEquals(null, graph.preferences.get(PreferenceKey.PushSent))
            assertNotEquals(null, graph.preferences.get(PreferenceKey.PushInstallationId))
        }

    @Test
    fun forgetFailingDoesNotThrow() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            backend.on(
                "$route/${graph.push.installationId}",
                { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") },
            )
            signIn(graph, backend)
            graph.push.forget()
            assertEquals(
                "DELETE",
                backend
                    .devices()
                    .last()
                    .method.value,
            )
        }

    @Test
    fun markNotificationReadPostsToTheClinicHost() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            backend.on("$SUNRISE/api/v1/notifications/n-1/read", { json("", HttpStatusCode.NoContent) })
            assertIs<Outcome.Success<*>>(clinic.api.markNotificationRead("n-1"))
            assertEquals(
                "POST",
                backend.requests
                    .last()
                    .method.value,
            )
            backend.on("$SUNRISE/api/v1/notifications/n-2/read", { apiError(HttpStatusCode.NotFound, "not_found") })
            assertIs<Outcome.Failure<*>>(clinic.api.markNotificationRead("n-2"))
        }

    @Test
    fun aRestoredSessionIsZeroAndEachLaterSignInCountsUp() =
        runTest {
            val user =
                checkNotNull(
                    com.sakalya.mobile.auth.UserId
                        .parse("01a1de2b-0000-7000-8000-000000000001"),
                )
            val states =
                kotlinx.coroutines.flow.flowOf(
                    com.sakalya.mobile.auth.SessionState.Restoring,
                    com.sakalya.mobile.auth.SessionState
                        .SignedIn(user),
                    com.sakalya.mobile.auth.SessionState
                        .SignedOut(com.sakalya.mobile.auth.SignOutReason.NeverSignedIn),
                    com.sakalya.mobile.auth.SessionState
                        .SignedIn(user),
                )
            assertEquals(listOf(null, 0, null, 1), pushSessions(states).toList())
        }
}
