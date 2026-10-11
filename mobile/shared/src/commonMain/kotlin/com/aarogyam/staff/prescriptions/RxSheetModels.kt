package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.Severity

/** Quick choices for a medicine line; codes the doctor writes, not copy. */
object RxPresets {
    val doses: List<String> = listOf("1 tablet", "2 tablets", "5 ml", "10 ml")
    val frequencies: List<String> = listOf("1-0-0", "0-1-0", "0-0-1", "1-0-1", "1-1-1", "SOS")
    val durations: List<Int> = listOf(3, 5, 7, 10, 14)
}

/** A medicine from the catalogue. */
data class DrugView(
    val id: String,
    val name: String,
    val brand: String?,
    val strength: String,
    val form: String,
    val defaultDose: String,
    val defaultFrequency: String,
    val defaultDays: Int?,
    val defaultTiming: String?,
)

/** One medicine on the prescription being written. [key] is stable while the line is on screen. */
data class RxLine(
    val key: Int,
    val drugId: String?,
    val name: String,
    val detail: String,
    val dose: String,
    val frequency: String,
    val durationDays: Int,
    val timing: String?,
)

/**
 * One alert from the clinic's own allergy check, as the server worded it: [message] names the
 * medicine and the recorded allergy (clinical text: show it, never log it).
 */
data class ServerAlert(
    val severity: Severity,
    val message: String,
)

/** A medicine whose name matches a recorded allergy. */
data class AllergyWarning(
    val lineKey: Int,
    val drug: String,
    val substance: String,
    val severity: Severity,
)

enum class RxPhase { Composing, Issuing, Issued }

data class IssuedRx(
    val id: String,
    val number: String?,
    val clinicName: String,
)

/** The patient's link and PIN. The PIN is shown once and never goes into the shared text. */
data class ShareView(
    val url: String,
    val pin: String,
    val expiresAt: ClinicMoment?,
)

sealed interface ShareState {
    data object Creating : ShareState

    data class Ready(
        val link: ShareView,
    ) : ShareState

    data class Failed(
        val error: ScreenError,
    ) : ShareState
}

data class RxSheetState(
    /** False when the role lacks `prescriptions.issue`; nothing is requested then. */
    val allowed: Boolean = true,
    val query: String = "",
    val results: List<DrugView> = emptyList(),
    val searching: Boolean = false,
    val lines: List<RxLine> = emptyList(),
    /** Local match of the lines against the patient's recorded allergies. */
    val warnings: List<AllergyWarning> = emptyList(),
    /** The clinic's own allergy check stopped the issue (it also knows drug classes). */
    val serverAlert: Boolean = false,
    /** What the clinic's check said; empty when it stopped the issue without a readable body. */
    val serverAlerts: List<ServerAlert> = emptyList(),
    val overrideReason: String = "",
    val phase: RxPhase = RxPhase.Composing,
    val error: ScreenError? = null,
    val issued: IssuedRx? = null,
    val share: ShareState? = null,
    /** The server draft (`saveDraft`); none until the doctor saves. */
    val draft: DraftSave = DraftSave.None,
) {
    /** Issuing needs an override reason while any allergy alert stands. */
    val needsOverride: Boolean get() = warnings.isNotEmpty() || serverAlert

    val canIssue: Boolean
        get() =
            allowed &&
                phase == RxPhase.Composing &&
                lines.isNotEmpty() &&
                (!needsOverride || overrideReason.trim().length >= MIN_REASON)

    internal companion object {
        const val MIN_REASON = 3
    }
}
