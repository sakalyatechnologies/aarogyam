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

    @Test
    fun a_password_signs_in_and_is_cleared() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUPABASE/auth/v1/token", { json(sessionJson()) })
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.usePassword()
            assertEquals(SignInStep.Password, holder.state.value.step)
            holder.onPasswordChange("a long passphrase")
            holder.submitPassword()
            assertIs<SessionState.SignedIn>(graph.sessionState.first { it is SessionState.SignedIn })
            assertEquals("", holder.state.first { !it.busy }.password)
            val request = backend.requests.single { it.url.encodedPath == "/auth/v1/token" }
            assertEquals("password", request.url.parameters["grant_type"])
        }

    @Test
    fun a_wrong_password_is_reported_and_cleared() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUPABASE/auth/v1/token",
                { json("""{"error_code":"invalid_credentials","msg":"x"}""", HttpStatusCode.BadRequest) },
            )
            val graph = testGraph(backend, backgroundScope)
            val holder = graph.signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.usePassword()
            holder.onPasswordChange("wrong")
            holder.submitPassword()
            val state = holder.state.first { it.error != null }
            assertEquals(SignInError.WrongPassword, state.error)
            assertEquals(SignInStep.Password, state.step)
            assertEquals("", state.password)
            assertIs<SessionState.SignedOut>(graph.sessionState.value)
        }

    @Test
    fun throttled_password_attempts_are_reported() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUPABASE/auth/v1/token",
                { apiError(HttpStatusCode.TooManyRequests, "over_request_rate_limit") },
            )
            val holder = testGraph(backend, backgroundScope).signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.usePassword()
            holder.onPasswordChange("whatever")
            holder.submitPassword()
            assertEquals(SignInError.TooManyAttempts, holder.state.first { it.error != null }.error)
        }

    @Test
    fun an_empty_password_or_bad_email_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = testGraph(backend, backgroundScope).signIn(this)
            holder.onEmailChange("asha.patil@example.com")
            holder.usePassword()
            holder.submitPassword()
            assertEquals(SignInError.WrongPassword, holder.state.value.error)
            holder.onEmailChange("nope")
            holder.onPasswordChange("x")
            holder.submitPassword()
            assertEquals(SignInError.InvalidEmail, holder.state.value.error)
            assertEquals("", holder.state.value.password)
            assertTrue(backend.requests.isEmpty())
        }

    @Test
    fun switching_back_or_changing_email_clears_the_password() =
        runTest {
            val holder = testGraph(FakeBackend(), backgroundScope).signIn(this)
            holder.usePassword()
            holder.onPasswordChange("secret")
            holder.useCode()
            assertEquals(SignInStep.Email, holder.state.value.step)
            assertEquals("", holder.state.value.password)
            holder.usePassword()
            holder.onPasswordChange("secret")
            holder.changeEmail()
            assertEquals("", holder.state.value.password)
        }
}
