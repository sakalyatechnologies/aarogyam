package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.Sex

/** What the desk can do next from the lookup. Phones are for the screen only, never logged. */
sealed interface DeskAction {
    data class NewPatient(
        val prefilledPhone: String,
    ) : DeskAction

    /** Another person on this number; the family relation itself is a future server field. */
    data class AddFamilyMember(
        val phone: String,
    ) : DeskAction

    data class CheckIn(
        val patientId: String,
    ) : DeskAction
}

/** One row of the profile picker. */
data class DeskProfile(
    val id: String,
    val number: String,
    val initials: String,
    val ageYears: Int?,
    val sex: Sex,
    /** RFC 3339 of the last visit; null until the lookup carries it. */
    val lastVisit: String?,
    val checkedInToday: Boolean,
    /** Today's state when checked in; null otherwise. */
    val state: PatientState?,
    /** Relation to the number's owner; null until the server sends family relations. */
    val relation: String? = null,
)

/** What the Desk lookup draws. */
sealed interface DeskLookupState {
    /** Nothing typed, or not a complete number yet. */
    data object Idle : DeskLookupState

    data object Looking : DeskLookupState

    /** One or many registered patients; [actions] always offers a new patient and a family member. */
    data class Matches(
        val phone: String,
        val profiles: List<DeskProfile>,
        val actions: List<DeskAction>,
    ) : DeskLookupState

    /** Nobody has this number: the only action is a new patient. */
    data class NoMatch(
        val phone: String,
        val actions: List<DeskAction>,
    ) : DeskLookupState

    data class Failed(
        val error: ScreenError,
    ) : DeskLookupState

    /** The role lacks a permission the desk needs; nothing was requested. */
    data object NotAllowed : DeskLookupState

    /** [patientId] joined today's queue as token [tokenNumber]. */
    data class CheckedIn(
        val patientId: String,
        val tokenNumber: Int,
    ) : DeskLookupState
}

/** Up to two letters from the first and last name words. */
fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = listOfNotNull(words.firstOrNull(), words.drop(1).lastOrNull()).map { it.first().uppercaseChar() }
    return letters.joinToString("")
}
