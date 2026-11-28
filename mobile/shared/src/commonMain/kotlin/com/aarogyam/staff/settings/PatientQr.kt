package com.aarogyam.staff.settings

import com.aarogyam.staff.nav.NavModel

/** The two codes behind the one "Patient QR" sheet. */
enum class PatientQrTab { CheckIn, Book }

/** Who sees which tab of the Patient QR sheet, and who may change the check-in code. One place to change a gate. */
object PatientQr {
    /**
     * Whether the Check in tab shows. The server lets anyone with patients.read (desk, doctor, assistant) read the self
     * check-in QR; changing it (the switch, a new key) stays settings.manage. This is the single line to change.
     */
    fun canShowCheckInQr(permissions: Set<String>): Boolean = NavModel.PATIENTS_READ in permissions

    /** The switch and "Make a new QR" change the clinic's setting, so they stay settings.manage. */
    fun canManageCheckInQr(permissions: Set<String>): Boolean = NavModel.SETTINGS_MANAGE in permissions

    /** Booking from Home starts in the walk-in search, which needs appointments.write. */
    fun canBook(permissions: Set<String>): Boolean = "appointments.write" in permissions

    /** The tabs to show, in order. Book is for everyone; a single tab shows without the control. */
    fun tabs(permissions: Set<String>): List<PatientQrTab> =
        buildList {
            if (canShowCheckInQr(permissions)) add(PatientQrTab.CheckIn)
            add(PatientQrTab.Book)
        }

    /** The tab to open on: [wanted] when allowed, otherwise the first one. */
    fun initial(
        permissions: Set<String>,
        wanted: PatientQrTab,
    ): PatientQrTab = tabs(permissions).let { if (wanted in it) wanted else it.first() }
}
