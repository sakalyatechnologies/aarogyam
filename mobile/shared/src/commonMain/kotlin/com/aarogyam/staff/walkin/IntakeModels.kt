package com.aarogyam.staff.walkin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.outbox.Refusal
import com.aarogyam.staff.patients.Sex

/** A field of the intake form, for inline errors. */
enum class IntakeField { Name, Birth, Phone, Email, Allergies, Consent, Signature, Reason }

/** Why a field is wrong; each platform maps these to copy. */
enum class IntakeProblem { Required, Invalid, InFuture }

/** The notice the consents are recorded against (read aloud from [body]). */
data class IntakeNotice(
    val id: String,
    val version: Int,
    val label: String,
    val body: String,
)

/** Why "Save & queue" did not finish. */
sealed interface IntakeSubmitError {
    /** Offline: nothing was sent or queued and the form is kept. */
    data object NeedsConnection : IntakeSubmitError

    /** The IntakeDeps are not installed (a wiring bug); nothing was sent. */
    data object NotWired : IntakeSubmitError

    data class Server(
        val error: ScreenError,
    ) : IntakeSubmitError
}

/** The patient was registered and queued; [filesQueued] files wait for upload, [filesRefused] could not be saved. */
data class IntakeDone(
    val patientId: String,
    val tokenId: String,
    val tokenNumber: Int,
    val filesQueued: Int,
    val filesRefused: Refusal? = null,
)

/** Everything the desk entered, plus reference data and the result. Patient data: never logged. */
data class IntakeForm(
    val name: String = "",
    /** `YYYY-MM-DD`, or empty when [age] is used. */
    val dateOfBirth: String = "",
    val age: String = "",
    val phone: String = "",
    val email: String = "",
    val sex: Sex? = null,
    val allergies: Set<String> = emptySet(),
    val noKnownAllergies: Boolean = false,
    /** The notice was read aloud and the patient agrees to treatment and their record (`care`). */
    val readAloud: Boolean = false,
    val reminders: Boolean = true,
    val signaturePresent: Boolean = false,
    val photoPresent: Boolean = false,
    val practitionerId: String? = null,
    /** Shown only when `ServerCaps.walkInReason` is on. */
    val reason: String = "",
    /** Shown only when `ServerCaps.family` is on. */
    val familyOf: FamilyOf? = null,
    val errors: Map<IntakeField, IntakeProblem> = emptyMap(),
    val submitting: Boolean = false,
    val submitError: IntakeSubmitError? = null,
    val done: IntakeDone? = null,
    val doctors: List<DoctorOption> = emptyList(),
    val allergyPicks: List<String> = emptyList(),
    val notice: IntakeNotice? = null,
    val showReason: Boolean = false,
    val showFamily: Boolean = false,
)
