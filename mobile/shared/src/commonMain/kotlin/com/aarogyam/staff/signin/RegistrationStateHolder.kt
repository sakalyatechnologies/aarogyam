package com.aarogyam.staff.signin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.AppApi
import com.aarogyam.staff.api.model.NewRegistration
import com.aarogyam.staff.api.register
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A field the registration form checks. */
enum class RegistrationField { ClinicName, City, ContactName, Email, Phone }

/** The clinic's specialty, as the server names it. */
enum class Specialty(
    internal val wire: String,
) {
    Dental("dental"),
    General("general"),
}

data class RegistrationState(
    val clinicName: String = "",
    val city: String = "",
    val contactName: String = "",
    val email: String = "",
    val phone: String = "",
    val specialty: Specialty = Specialty.Dental,
    val message: String = "",
    /** Fields that fail their check, shown once the person tries to send. */
    val invalid: Set<RegistrationField> = emptySet(),
    val sending: Boolean = false,
    val error: ScreenError? = null,
    /** Sent: Sakalya reviews it and emails the owner's invitation. */
    val received: Boolean = false,
)

/** "Register your clinic": the same `POST /registrations` the web page uses. Nothing is logged but the outcome. */
class RegistrationStateHolder(
    private val app: AppApi?,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.registration"),
) {
    private val mutableState = MutableStateFlow(RegistrationState())
    val state: StateFlow<RegistrationState> = mutableState.asStateFlow()

    fun update(change: (RegistrationState) -> RegistrationState) = mutableState.update { change(it).copy(error = null) }

    fun send() {
        val s = mutableState.value
        if (s.sending || s.received) return
        val invalid = check(s)
        mutableState.update { it.copy(invalid = invalid) }
        if (invalid.isNotEmpty()) return
        val api = app ?: return mutableState.update { it.copy(error = ScreenError.NotConfigured) }
        mutableState.update { it.copy(sending = true) }
        scope.launch {
            val body =
                NewRegistration(
                    clinicName = s.clinicName.trim(),
                    city = s.city.trim(),
                    contactName = s.contactName.trim(),
                    email = s.email.trim(),
                    phone = s.phone.trim().ifEmpty { null },
                    specialty = s.specialty.wire,
                    message = s.message.trim().ifEmpty { null },
                )
            when (val answer = api.register(body)) {
                is Outcome.Success -> {
                    log.info("registration.sent")
                    mutableState.update { it.copy(sending = false, received = true) }
                }

                is Outcome.Failure -> {
                    log.warn("registration.failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(sending = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    internal companion object {
        private val email = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
        private val phone = Regex("^\\+?[0-9 ]{10,15}$")

        fun check(s: RegistrationState): Set<RegistrationField> =
            buildSet {
                if (s.clinicName.isBlank() || s.clinicName.length > MAX) add(RegistrationField.ClinicName)
                if (s.city.isBlank() || s.city.length > MAX) add(RegistrationField.City)
                if (s.contactName.isBlank() || s.contactName.length > MAX) add(RegistrationField.ContactName)
                if (!email.matches(s.email.trim())) add(RegistrationField.Email)
                if (s.phone.isNotBlank() && !phone.matches(s.phone.trim())) add(RegistrationField.Phone)
            }

        private const val MAX = 120
    }
}
