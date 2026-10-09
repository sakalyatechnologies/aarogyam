package com.aarogyam.staff.walkin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.Sex

/** Who the walk-in is: nobody chosen yet, a registered patient, or someone new. */
sealed interface Who {
    data object None : Who

    data class Existing(
        val id: String,
        val name: String,
        val number: String,
    ) : Who

    data object New : Who
}

/** A registered patient with the typed number; shown on screen only, never logged. */
data class PhoneMatchRow(
    val id: String,
    val name: String,
    val number: String,
    val ageYears: Int?,
    val sex: Sex,
)

/** The phone lookup under the mobile field. */
sealed interface LookupState {
    /** The number is not a complete Indian mobile yet. */
    data object Idle : LookupState

    data object Looking : LookupState

    data class Matches(
        val items: List<PhoneMatchRow>,
    ) : LookupState

    data object Failed : LookupState
}

/** Why "Add to queue" did not send; each platform maps these to copy. */
enum class WalkInProblem { PickPatient, NameRequired, AgeInvalid }

/** A doctor the walk-in can be assigned to. */
data class DoctorOption(
    val id: String,
    val name: String,
)

/** Everything the receptionist entered, plus what the screen needs to draw it. */
data class WalkInForm(
    val mobile: String = "",
    val lookup: LookupState = LookupState.Idle,
    val who: Who = Who.None,
    val name: String = "",
    val age: String = "",
    val sex: Sex? = null,
    val allergies: Set<String> = emptySet(),
    val noKnownAllergies: Boolean = false,
    val reminders: Boolean = true,
    val doctorId: String? = null,
    val doctors: List<DoctorOption> = emptyList(),
    val allergyPicks: List<String> = emptyList(),
    val submitting: Boolean = false,
    val problem: WalkInProblem? = null,
    val error: ScreenError? = null,
) {
    /** The new-patient fields show for someone new, or when there is no number at all. */
    val showNewPatient: Boolean get() = who == Who.New || (mobile.isEmpty() && who == Who.None)
}

/** What the Walk-in screen draws. */
sealed interface WalkInState {
    /** The role cannot register walk-ins; nothing was requested. */
    data object NotAllowed : WalkInState

    data class Editing(
        val form: WalkInForm,
    ) : WalkInState

    /** The patient is in the queue with [tokenNumber]. */
    data class Done(
        val name: String,
        val tokenNumber: Int,
        val registered: Boolean,
    ) : WalkInState
}
