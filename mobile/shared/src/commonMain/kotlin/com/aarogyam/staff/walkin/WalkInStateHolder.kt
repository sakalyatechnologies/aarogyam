package com.aarogyam.staff.walkin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.registerWalkIn
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The one-step walk-in: mobile first (registered matches show as soon as it is complete), then
 * name, age, sex, allergies, consent and doctor, then one `POST /walk-ins`. Doctors and allergy
 * chips come from the clinic's cached reference data.
 */
class WalkInStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.walkin"),
    debounceMillis: Long = PhoneLookupRunner.DEBOUNCE_MILLIS,
) {
    private val mutableState = MutableStateFlow<WalkInState>(WalkInState.Editing(WalkInForm()))

    /** The current screen state. */
    val state: StateFlow<WalkInState> = mutableState.asStateFlow()

    private val lookup =
        PhoneLookupRunner(clinic.api, scope, debounceMillis, log) { result ->
            // Nobody registered with the number: it is someone new, without an extra tap.
            val nobody = result is LookupState.Matches && result.items.isEmpty()
            edit { copy(lookup = result, who = if (nobody && who == Who.None) Who.New else who) }
        }

    init {
        if (REQUIRED.all { it in clinic.permissions }) loadReference() else mutableState.value = WalkInState.NotAllowed
    }

    /** The desk typed into the mobile field; a complete number looks up registered patients. */
    fun setMobile(typed: String) {
        val digits = mobileDigits(typed)
        val form = (mutableState.value as? WalkInState.Editing)?.form ?: return
        if (digits == form.mobile) return
        // A new number decides afresh who the walk-in is.
        edit { copy(mobile = digits, who = Who.None, lookup = LookupState.Idle, problem = null) }
        lookup.request(digits.takeIf { isCompleteMobile(it) })
    }

    /** "This is them": the walk-in is the registered patient [match]. */
    fun pick(match: PhoneMatchRow) =
        edit { copy(who = Who.Existing(match.id, match.name, match.number), problem = null) }

    /** None of the matches: register someone new with this number. */
    fun someoneNew() = edit { copy(who = Who.New, problem = null) }

    fun setName(text: String) = edit { copy(name = text, problem = null) }

    /** Age in years; anything but digits is dropped. */
    fun setAge(text: String) = edit { copy(age = text.filter { it.isDigit() }.take(AGE_DIGITS), problem = null) }

    fun setSex(value: Sex) = edit { copy(sex = if (sex == value) null else value) }

    /** Toggles a reported allergy; any allergy clears "No known allergies". */
    fun toggleAllergy(label: String) =
        edit {
            copy(
                allergies =
                    if (label in
                        allergies
                    ) {
                        allergies - label
                    } else {
                        allergies + label
                    },
                noKnownAllergies = false,
            )
        }

    fun toggleNoKnownAllergies() = edit { copy(noKnownAllergies = !noKnownAllergies, allergies = emptySet()) }

    fun setReminders(on: Boolean) = edit { copy(reminders = on) }

    fun setDoctor(id: String?) = edit { copy(doctorId = id) }

    /** "Add to queue": validates, then sends one request. A second tap while sending is ignored. */
    fun submit() {
        val form = (mutableState.value as? WalkInState.Editing)?.form ?: return
        if (form.submitting) return
        val request =
            when (val built = walkInRequest(form)) {
                is Result.Problem -> return edit { copy(problem = built.problem) }
                is Result.Ok -> built.value
            }
        edit { copy(submitting = true, problem = null, error = null) }
        scope.launch {
            when (val result = clinic.api.registerWalkIn(request)) {
                is Outcome.Success -> {
                    val done = result.value
                    log.info("walkin.registered") {
                        id("patient_id", done.patient.id)
                        id("queue_token_id", done.token.id)
                    }
                    mutableState.value =
                        WalkInState.Done(done.patient.fullName, done.token.tokenNumber, done.registered)
                }

                is Outcome.Failure -> {
                    log.warn("walkin.register_failed") { code("error", result.error.code.value) }
                    edit { copy(submitting = false, error = ScreenError.of(result.error)) }
                }
            }
        }
    }

    /** After a walk-in is queued: a clean form for the next one, keeping the reference data. */
    fun startAnother() {
        mutableState.value = WalkInState.Editing(WalkInForm())
        loadReference()
    }

    private fun loadReference() {
        scope.launch {
            val (doctors, picks) = loadWalkInReference(clinic)
            edit { copy(doctors = doctors, allergyPicks = picks) }
        }
    }

    private fun edit(change: WalkInForm.() -> WalkInForm) =
        mutableState.update { if (it is WalkInState.Editing) it.copy(form = it.form.change()) else it }

    private companion object {
        val REQUIRED = listOf("patients.read", "patients.write", "appointments.write", "intake.write")
        const val AGE_DIGITS = 3
    }
}
