package com.aarogyam.staff.queue

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.walkin.DoctorOption
import com.aarogyam.staff.walkin.PhoneMatchRow

/** One QR check-in waiting for the desk. Patient data: shown on screen only, never logged. */
data class ArrivalRow(
    val id: String,
    /** The name the patient submitted. */
    val name: String,
    val phone: String,
    val ageYears: Int?,
    val sex: Sex,
    val reasons: List<String>,
    val matches: List<PhoneMatchRow>,
    /** Linked relatives of the matches who are not matches themselves: extra choices. */
    val relatives: List<ArrivalRelative> = emptyList(),
    /** The registered patient picked from [matches] or [relatives]; null means "New patient" (the default). */
    val chosenPatientId: String? = null,
    /** The doctor picked; null means any doctor (the default). */
    val chosenDoctorId: String? = null,
    val busy: Boolean = false,
)

/** A relative offered beside the phone matches. [relation] is what they are to the matched patient (`guardian`, `child`, ...). */
data class ArrivalRelative(
    val id: String,
    val name: String,
    val number: String,
    val relation: String,
)

/** The "N checked in by QR" strip and its sheet. */
sealed interface ArrivalsState {
    /** The role cannot read arrivals; the strip is hidden. */
    data object Hidden : ArrivalsState

    data class Shown(
        val rows: List<ArrivalRow> = emptyList(),
        /** The role may accept (patients, appointments and intake write); otherwise only the list shows. */
        val canAccept: Boolean = false,
        /** Active doctors for the optional picker; empty until loaded or when none are listed. */
        val doctors: List<DoctorOption> = emptyList(),
        /** Set when a row was already handled by someone else. */
        val notice: ArrivalNotice? = null,
        val error: ScreenError? = null,
    ) : ArrivalsState {
        val count: Int get() = rows.size
    }
}

enum class ArrivalNotice { AlreadyHandled }
