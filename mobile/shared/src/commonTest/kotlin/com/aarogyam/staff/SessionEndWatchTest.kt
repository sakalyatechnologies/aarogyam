package com.aarogyam.staff

import com.sakalya.mobile.auth.SessionState
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class SessionEndWatchTest {
    @Test
    fun a_refusal_after_a_fresh_token_signs_out() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { apiError(HttpStatusCode.Unauthorized, "unauthenticated") })
            backend.on("$SUPABASE/auth/v1/token", { json(sessionJson(access = jwt("b"), refresh = "r2")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            graph.today(clinic, backgroundScope)
            graph.sessionState.first { it is SessionState.SignedOut }
            assertEquals(1, backend.count("$SUPABASE/auth/v1/token"), "the token was refreshed once first")
        }

    @Test
    fun a_refusal_that_the_refresh_fixes_keeps_the_session() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/session",
                { apiError(HttpStatusCode.Unauthorized, "unauthenticated") },
                { json(sessionBody(listOf("appointments.read"))) },
            )
            backend.on("$SUPABASE/auth/v1/token", { json(sessionJson(access = jwt("b"), refresh = "r2")) })
            val graph = testGraph(backend, backgroundScope)
            backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
            signIn(graph, backend)
            val picker = graph.clinicPicker(this, autoOpenSingle = false)
            picker.state.first { it is com.aarogyam.staff.clinic.ClinicPickerState.Choose }
            picker.select("sunrise")
            graph.directory.current.first { it != null }
            assertEquals(2, backend.count("$SUNRISE/api/v1/session"))
            assertIs<SessionState.SignedIn>(graph.sessionState.value)
        }
}
