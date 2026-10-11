package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.lookupByPhone
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.api.registerWalkIn
import com.aarogyam.staff.api.model.DeskConsentFields
import com.aarogyam.staff.api.model.WalkInRequest
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.sexOf
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Front-desk search by mobile number: debounced `POST /patients/lookup`, a profile picker and the
 * next actions. CheckIn reuses `POST /walk-ins` with the existing patient. Whether someone is
 * checked in today comes from the queue. The phone number is never logged.
 */
class DeskLookupStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.desk"),
    private val debounceMillis: Long = DEBOUNCE_MILLIS,
) {
    private val allowed = REQUIRED.all { it in clinic.permissions }
    private val mutableState =
        MutableStateFlow<DeskLookupState>(if (allowed) DeskLookupState.Idle else DeskLookupState.NotAllowed)

    val state: StateFlow<DeskLookupState> = mutableState.asStateFlow()

    private var job: Job? = null
    private var requested: String? = null
    private var checkingIn = false

    /** The desk typed [typed]; a complete number is looked up after a pause. */
    fun search(typed: String) {
        if (!allowed) return
        val phone = normaliseIndianPhone(typed)
        if (phone != null && phone == requested) return
        job?.cancel()
        requested = phone
        if (phone == null) {
            mutableState.value = DeskLookupState.Idle
            return
        }
        mutableState.value = DeskLookupState.Looking
        job = scope.launch {
            delay(debounceMillis)
            lookup(phone)
        }
    }

    /** Checks in the registered patient [patientId]; a second tap while sending is ignored. */
    fun checkIn(patientId: String) {
        if (!allowed || checkingIn) return
        checkingIn = true
        scope.launch {
            val request =
                WalkInRequest(patientId = patientId, consents = listOf(DeskConsentFields(method = "verbal", purpose = "care")))
            when (val result = clinic.api.registerWalkIn(request)) {
                is Outcome.Success -> {
                    log.info("desk.checked_in") { id("patient_id", patientId) }
                    mutableState.value = DeskLookupState.CheckedIn(patientId, result.value.token.tokenNumber)
                }
                is Outcome.Failure -> {
                    log.warn("desk.check_in_failed") { code("error", result.error.code.value) }
                    mutableState.value = DeskLookupState.Failed(ScreenError.of(result.error))
                }
            }
            checkingIn = false
        }
    }

    private suspend fun lookup(phone: String) {
        when (val found = clinic.api.lookupByPhone(phone)) {
            is Outcome.Failure -> {
                log.warn("desk.lookup_failed") { code("error", found.error.code.value) }
                requested = null
                mutableState.value = DeskLookupState.Failed(ScreenError.of(found.error))
            }
            is Outcome.Success -> {
                if (found.value.items.isEmpty()) {
                    mutableState.value = DeskLookupState.NoMatch(phone, listOf(DeskAction.NewPatient(phone)))
                    return
                }
                val today = todaysStates()
                val profiles =
                    found.value.items.map {
                        val state = today[it.id]
                        DeskProfile(it.id, it.number, initialsOf(it.fullName), it.ageYears, sexOf(it.sex), null, state != null, state)
                    }
                val actions =
                    profiles.filter { !it.checkedInToday }.map { DeskAction.CheckIn(it.id) } +
                        listOf(DeskAction.AddFamilyMember(phone), DeskAction.NewPatient(phone))
                mutableState.value = DeskLookupState.Matches(phone, profiles, actions)
            }
        }
    }

    /** Patient id to today's state for everyone in the queue; empty when the queue is unavailable. */
    private suspend fun todaysStates(): Map<String, PatientState> =
        (clinic.api.queue() as? Outcome.Success)
            ?.value
            ?.items
            ?.mapNotNull { t -> patientState(t.status)?.let { t.patient.id to it } }
            ?.toMap()
            .orEmpty()

    companion object {
        const val DEBOUNCE_MILLIS = 300L
        private val REQUIRED = listOf("patients.read", "appointments.read", "appointments.write", "intake.write")
    }
}
