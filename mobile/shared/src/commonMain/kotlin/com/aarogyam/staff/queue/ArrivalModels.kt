package com.aarogyam.staff.queue

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.Sex
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
    /** The registered patient picked from [matches]; null means "New patient" (the default). */
    val chosenPatientId: String? = null,
    val busy: Boolean = false,
)

/** The "N checked in by QR" strip and its sheet. */
sealed interface ArrivalsState {
    /** The role cannot read arrivals; the strip is hidden. */
    data object Hidden : ArrivalsState

    data class Shown(
        val rows: List<ArrivalRow> = emptyList(),
        /** The role may accept (patients, appointments and intake write); otherwise only the list shows. */
        val canAccept: Boolean = false,
        /** Set when a row was already handled by someone else. */
        val notice: ArrivalNotice? = null,
        val error: ScreenError? = null,
    ) : ArrivalsState {
        val count: Int get() = rows.size
    }
}

enum class ArrivalNotice { AlreadyHandled }
