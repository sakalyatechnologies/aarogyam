package com.aarogyam.staff.signin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUPABASE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.sessionJson
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.auth.SessionState
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class SignInStateHolderTest {
    @Test
    fun an_invalid_email_is_refused_without_a_request() =
        runTest {
            val backend = FakeBackend()
            val holder = testGraph(backend, backgroundScope).signIn(this)
            holder.onEmailChange("not an email")
            holder.submitEmail()
            assertEquals(SignInError.InvalidEmail, holder.state.value.error)
            assertTrue(backend.requests.isEmpty())
        }

    @Test
    fun email_then_code_signs_the_person_in() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUPABASE/auth/v1/otp", { json("{}") })
            backend.on("$SUPABASE/auth/v1/verify", { json(sessionJson()) })
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.signIn(this)

            holder.onEmailChange(" asha.patil@example.com ")
            holder.submitEmail()
            holder.state.first { it.step == SignInStep.Code }
            holder.onCodeChange("12 34-56")
            assertEquals("123456", holder.state.value.code)
            holder.submitCode()

            assertIs<SessionState.SignedIn>(graph.sessionState.first { it is SessionState.SignedIn })
            assertEquals(1, backend.count("$SUPABASE/auth/v1/otp"))
            assertTrue(backend.requests.all { it.headers["apikey"] == "pk-test" })
        }

    @Test
    fun a_rejected_code_keeps_the_code_step() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUPABASE/auth/v1/otp", { json("{}") })
            backend.on(
                "$SUPABASE/auth/v1/verify",
                { json("""{"error_code":"otp_expired","msg":"x"}""", HttpStatusCode.Forbidden) },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.submitEmail()
            holder.state.first { it.step == SignInStep.Code }
            holder.onCodeChange("123456")
            holder.submitCode()

            val state = holder.state.first { it.error != null }
            assertEquals(SignInError.CodeRejected, state.error)
            assertEquals(SignInStep.Code, state.step)
            assertIs<SessionState.SignedOut>(graph.sessionState.value)
        }

    @Test
    fun throttling_is_reported_as_too_many_attempts() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUPABASE/auth/v1/otp",
                { apiError(HttpStatusCode.TooManyRequests, "over_email_send_rate_limit") },
            )
            val holder = testGraph(backend, backgroundScope).signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.submitEmail()
            assertEquals(SignInError.TooManyAttempts, holder.state.first { it.error != null }.error)
            assertEquals(SignInStep.Email, holder.state.value.step)
        }

    @Test
    fun change_email_returns_to_the_first_step() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUPABASE/auth/v1/otp", { json("{}") })
            val holder = testGraph(backend, backgroundScope).signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.submitEmail()
            holder.state.first { it.step == SignInStep.Code }
            holder.changeEmail()
            assertEquals(SignInStep.Email, holder.state.value.step)
            assertEquals("asha.patil@example.com", holder.state.value.email)
        }
}
