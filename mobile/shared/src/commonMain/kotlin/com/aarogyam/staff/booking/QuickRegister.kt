package com.aarogyam.staff.booking

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.NewPatient
import com.aarogyam.staff.api.registerPatient
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.walkin.AddressField
import com.aarogyam.staff.walkin.AddressForm
import com.aarogyam.staff.walkin.PincodeAutofill
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A language a new patient prefers, as the server tags it. */
enum class PatientLanguage(
    internal val tag: String,
) {
    English("en-IN"),
    Hindi("hi-IN"),
    Marathi("mr-IN"),
    Gujarati("gu-IN"),
}

/** Why the new patient cannot be registered yet. */
enum class RegisterProblem { NameRequired, AgeInvalid, MobileInvalid, EmailInvalid }

/** New appointment for someone the search did not find: their details, typed once. */
data class QuickRegisterState(
    val allowed: Boolean,
    val name: String = "",
    val sex: Sex? = null,
    /** Whole years; the age is enough when the date of birth is unknown. */
    val age: String = "",
    /** Ten digits, optional. */
    val mobile: String = "",
    val email: String = "",
    val language: PatientLanguage = PatientLanguage.English,
    val address: AddressForm = AddressForm(),
    val saving: Boolean = false,
    val error: ScreenError? = null,
    /** The patient made, once: booking then goes on for them, and a retry never makes a second. */
    val createdId: String? = null,
)

/**
 * "Register and book": `POST /patients` with what the search box held as the name, then the
 * booking sheet for the new patient. The id is kept, so if booking fails the same patient stays
 * picked and nothing is registered twice.
 */
class QuickRegisterStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.register"),
) {
    private val mutableState = MutableStateFlow(QuickRegisterState(allowed = PATIENTS_WRITE in clinic.permissions))
    val state: StateFlow<QuickRegisterState> = mutableState.asStateFlow()

    /** Starts the form from the search text, unless a patient was already made. */
    fun start(searched: String) =
        mutableState.update {
            if (it.createdId !=
                null
            ) {
                it
            } else {
                it.copy(name = searched.trim().take(MAX_NAME), error = null)
            }
        }

    fun setName(text: String) = edit { it.copy(name = text.take(MAX_NAME)) }

    fun setSex(sex: Sex?) = edit { it.copy(sex = sex) }

    fun setAge(text: String) = edit { it.copy(age = text.filter(Char::isDigit).take(AGE_DIGITS)) }

    fun setMobile(text: String) = edit { it.copy(mobile = text.filter(Char::isDigit).takeLast(MOBILE_DIGITS)) }

    fun setEmail(text: String) = edit { it.copy(email = text.trim().take(MAX_EMAIL)) }

    private val autofill =
        PincodeAutofill(clinic.api, scope, log) { change -> edit { it.copy(address = change(it.address)) } }

    /** Types into one part of the address; a full PIN fills district and state. */
    fun setAddress(
        field: AddressField,
        text: String,
    ) {
        edit { it.copy(address = it.address.with(field, text)) }
        if (field == AddressField.Pincode) autofill.typed(AddressForm().with(field, text).pincode)
    }

    fun setLanguage(language: PatientLanguage) = edit { it.copy(language = language) }

    /** The first problem, or null when Register and book can go. */
    fun problem(s: QuickRegisterState = mutableState.value): RegisterProblem? =
        when {
            s.name.trim().length < MIN_NAME -> RegisterProblem.NameRequired
            s.age.isNotEmpty() && (s.age.toIntOrNull() ?: Int.MAX_VALUE) > MAX_AGE -> RegisterProblem.AgeInvalid
            s.mobile.isNotEmpty() && s.mobile.length != MOBILE_DIGITS -> RegisterProblem.MobileInvalid
            s.email.isNotEmpty() && !EMAIL.matches(s.email) -> RegisterProblem.EmailInvalid
            else -> null
        }

    /** Registers the patient once; [createdId] tells the screen to book for them. */
    fun register() {
        val s = mutableState.value
        if (!s.allowed || s.saving || s.createdId != null || problem(s) != null) return
        mutableState.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NewPatient(
                    fullName = s.name.trim(),
                    ageYears = s.age.toIntOrNull(),
                    phone = s.mobile.takeIf { it.isNotEmpty() }?.let { "+91$it" },
                    email = s.email.takeIf { it.isNotEmpty() },
                    sex = s.sex?.wire,
                    preferredLanguage = s.language.tag,
                    address = s.address.toApi(),
                )
            when (val answer = clinic.api.registerPatient(body)) {
                is Outcome.Success -> {
                    log.info("patient.registered") { id("patient", answer.value.id) }
                    mutableState.update { it.copy(saving = false, createdId = answer.value.id) }
                }

                is Outcome.Failure -> {
                    log.warn("patient.register_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    private fun edit(change: (QuickRegisterState) -> QuickRegisterState) =
        mutableState.update { if (it.createdId != null) it else change(it).copy(error = null) }

    private val Sex.wire: String
        get() =
            when (this) {
                Sex.Female -> "female"
                Sex.Male -> "male"
                Sex.Other -> "other"
                Sex.Unknown -> "unknown"
            }

    private companion object {
        const val PATIENTS_WRITE = "patients.write"
        const val MIN_NAME = 2
        const val MAX_NAME = 200
        const val MAX_AGE = 120
        const val AGE_DIGITS = 3
        const val MOBILE_DIGITS = 10
        const val MAX_EMAIL = 200
        val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    }
}
