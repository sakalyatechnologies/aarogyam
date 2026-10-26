package com.aarogyam.staff.nav

/** The first tab's content for a person (v10 R13). */
enum class Home {
    /** Today with the "Waiting for you" card for the person's own practitioner id. */
    Doctor,

    /** Number field, availability strip, board and My tasks. */
    Desk,

    /** What the app showed before v10. */
    Default,
}

/**
 * The choice: [home] leads; [deskReachable] says Desk is still offered (as a tab) when Doctor
 * leads. [practitionerId] is the person's doctor profile, set for the Doctor home once resolved.
 */
data class HomeChoice(
    val home: Home,
    val deskReachable: Boolean,
    val practitionerId: String? = null,
)

// The server's keys: `POST /queue/{id}/call` (Send in) needs clinical.write; walk-in, check-in and
// the queue need appointments.write; collecting needs payments.collect.
private const val CLINICAL_WRITE = "clinical.write"
private const val APPOINTMENTS_WRITE = "appointments.write"
private const val PAYMENTS_COLLECT = "payments.collect"

/** By permission key, never by role name: `clinical.write` is Doctor; desk keys without it are Desk. */
fun homeChoiceOf(permissions: Set<String>): HomeChoice {
    val doctor = CLINICAL_WRITE in permissions
    val desk = APPOINTMENTS_WRITE in permissions || PAYMENTS_COLLECT in permissions
    return when {
        doctor -> HomeChoice(Home.Doctor, deskReachable = desk)
        desk -> HomeChoice(Home.Desk, deskReachable = true)
        else -> HomeChoice(Home.Default, deskReachable = false)
    }
}
