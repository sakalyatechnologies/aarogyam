package com.aarogyam.patient

import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DevicesStateHolderTest {
    private val sessions = "$DEMO_APP/api/v1/me/patient/sessions"

    private fun session(
        id: String,
        current: Boolean,
    ) = """{"id":"$id","created_at":"2026-11-01T09:00:00+05:30","last_active_at":"2026-11-20T18:45:00+05:30",""" +
        """"expires_at":"2027-01-01T09:00:00+05:30","current":$current}"""

    @Test
    fun devices_list_marks_this_one_and_signing_out_another_asks_first() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson())
            backend.on(
                sessions,
                { json("""{"items":[${session("s1", true)},${session("s2", false)}]}""") },
                { json("""{"items":[${session("s1", true)}]}""") },
            )
            backend.on("$sessions/s2", { respond("", HttpStatusCode.NoContent) })
            val holder = graph.devices(backgroundScope)
            val first = holder.state.first { !it.loading }
            assertEquals(listOf(true, false), first.devices.map { it.current })
            assertEquals(
                2026,
                first.devices[1]
                    .lastActive
                    ?.date
                    ?.year,
            )

            holder.askSignOut("s1")
            assertNull(holder.state.value.confirming, "this device can't be signed out here")
            holder.askSignOut("s2")
            assertEquals("s2", holder.state.value.confirming)
            assertEquals(0, backend.requests.count { it.method == HttpMethod.Delete })
            holder.cancelConfirm()
            assertNull(holder.state.value.confirming)

            holder.askSignOut("s2")
            holder.confirmSignOut()
            val after = holder.state.first { it.signingOut == null && it.devices.size == 1 }
            assertEquals(listOf("s1"), after.devices.map { it.id })
            assertEquals(1, backend.requests.count { it.method == HttpMethod.Delete })
        }

    @Test
    fun a_failed_sign_out_keeps_the_list_and_says_so() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson())
            backend.on(sessions, { json("""{"items":[${session("s1", true)},${session("s2", false)}]}""") })
            backend.on("$sessions/s2", { apiError(HttpStatusCode.InternalServerError, "internal") })
            val holder = graph.devices(backgroundScope)
            holder.state.first { !it.loading }
            holder.askSignOut("s2")
            holder.confirmSignOut()
            val failed = holder.state.first { it.signOutFailed }
            assertEquals(2, failed.devices.size)
            assertTrue(failed.signingOut == null)
        }
}
