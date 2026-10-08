package com.aarogyam.patient.signin

import com.sakalya.mobile.auth.EmailAddress
import com.sakalya.mobile.auth.OneTimeCode
import com.sakalya.mobile.auth.SessionManager
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.ErrorCode
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Which part of the email-code sign-in is showing. */
enum class SignInStep { Email, Code }

/** Why sign-in did not move on. */
enum class SignInError {
    InvalidEmail,
    InvalidCode,

    /** Supabase would not send a code (no invitation for that address, or sign-in disabled). */
    EmailNotAccepted,
    CodeRejected,
    TooManyAttempts,
    Offline,
    Network,
    Unknown,
}

/** What the sign-in screen draws. */
data class SignInState(
    val step: SignInStep = SignInStep.Email,
    val email: String = "",
    val code: String = "",
    val busy: Boolean = false,
    val error: SignInError? = null,
)

/**
 * Email-code sign-in against Supabase, a copy of the staff app's holder (both move to
 * sakalya-mobile). A verified code signs the [sessions] in; the app's root
 * observes the session, so this holder never navigates.
 */
class SignInStateHolder(
    private val sessions: SessionManager,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(SignInState())

    /** The current screen state. */
    val state: StateFlow<SignInState> = mutableState.asStateFlow()

    fun onEmailChange(text: String) = mutableState.update { it.copy(email = text.trim(), error = null) }

    fun onCodeChange(text: String) =
        mutableState.update {
            it.copy(code = text.filter(Char::isDigit).take(CODE_LENGTH), error = null)
        }

    /** Sends a code to the entered address. */
    fun submitEmail() {
        val current = mutableState.value
        if (current.busy) return
        val email =
            EmailAddress.parse(current.email)
                ?: return mutableState.update { it.copy(error = SignInError.InvalidEmail) }
        mutableState.update { it.copy(busy = true, error = null) }
        scope.launch {
            when (val sent = sessions.requestEmailCode(email)) {
                is Outcome.Success -> mutableState.update { it.copy(busy = false, step = SignInStep.Code, code = "") }
                is Outcome.Failure -> mutableState.update { it.copy(busy = false, error = emailError(sent.error)) }
            }
        }
    }

    /** Verifies the entered code. */
    fun submitCode() {
        val current = mutableState.value
        if (current.busy) return
        val email = EmailAddress.parse(current.email) ?: return mutableState.update { it.copy(step = SignInStep.Email) }
        val code =
            OneTimeCode.parse(current.code) ?: return mutableState.update { it.copy(error = SignInError.InvalidCode) }
        mutableState.update { it.copy(busy = true, error = null) }
        scope.launch {
            when (val verified = sessions.verifyEmailCode(email, code)) {
                is Outcome.Success -> mutableState.update { it.copy(busy = false) }
                is Outcome.Failure -> mutableState.update { it.copy(busy = false, error = codeError(verified.error)) }
            }
        }
    }

    /** Back to the email step, to fix the address or ask for a new code. */
    fun changeEmail() = mutableState.update { it.copy(step = SignInStep.Email, code = "", error = null) }

    private fun emailError(error: ApiError): SignInError =
        common(error) ?: when (error.kind) {
            in REFUSED -> SignInError.EmailNotAccepted
            else -> SignInError.Unknown
        }

    private fun codeError(error: ApiError): SignInError =
        common(error) ?: when (error.kind) {
            in REFUSED, ApiErrorKind.Unauthenticated -> SignInError.CodeRejected
            else -> SignInError.Unknown
        }

    private fun common(error: ApiError): SignInError? =
        when {
            error.code == ErrorCode.Offline -> SignInError.Offline
            error.kind == ApiErrorKind.Transport -> SignInError.Network
            error.kind == ApiErrorKind.TooManyRequests -> SignInError.TooManyAttempts
            else -> null
        }

    private companion object {
        const val CODE_LENGTH = 8
        val REFUSED =
            setOf(ApiErrorKind.BadRequest, ApiErrorKind.Unprocessable, ApiErrorKind.Forbidden, ApiErrorKind.NotFound)
    }
}
