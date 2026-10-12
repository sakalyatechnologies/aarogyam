package com.aarogyam.staff.visit

/** The follow-up chips of Wrap up. [days] is null for "not needed". */
enum class FollowUpChoice(
    val days: Int?,
) {
    OneWeek(7),
    TwoWeeks(14),
    OneMonth(30),
    SixMonths(182),
    NotNeeded(null),
}

/** Where the patient goes after Wrap up. Both ways finish with `ready_to_bill` (plan D8). */
enum class FinishOutcome {
    /** The doctor collects now: open the collect sheet on [FinishedSummary.invoiceId]. */
    Collected,

    /** The desk is asked to collect. */
    SentToDesk,
}

/** An allergy the server found in the Rx; [severity] is `info`, `caution` or `serious`. */
data class FinishAlert(
    val severity: String,
    val message: String,
)

/** Why a finish failed, so the screen can translate it. [FinishPhase.Failed.message] is the English text. */
enum class FinishFailure {
    /** The visit is already closed (it was finished on another screen). */
    VisitClosed,
    NoteNotSaved,
    RxNotSaved,
    NotAllowed,
    Other,
}

/** What the celebration shows. Built from the server's answer; holds no patient name. */
data class FinishedSummary(
    val outcome: FinishOutcome,
    /** The draft bill, for the collect sheet; null when no fee was given. */
    val invoiceId: String?,
    val invoiceTotalPaise: Long?,
    val followUpOn: String?,
    val rxIssued: Boolean,
    val rxNumber: String?,
    val share: ShareStatus,
    val sharePin: String?,
    val shareToken: String?,
)

/** What happened to the patient's link for the Rx. */
enum class ShareStatus {
    /** No Rx was issued, or no link was asked for. */
    NotShared,

    /** The link and PIN are made; hand them over. */
    LinkReady,
}

sealed interface FinishPhase {
    data object Editing : FinishPhase

    data object Finishing : FinishPhase

    /** The server found allergy alerts: ask for a reason, then call `finish` again. */
    data class NeedsOverride(
        val alerts: List<FinishAlert>,
    ) : FinishPhase

    /** Offline with an Rx to issue: nothing was saved for later. Try again when connected. */
    data object NeedsConnection : FinishPhase

    /** Offline without an Rx: the finish is saved on the phone and goes out when the network returns. */
    data object Queued : FinishPhase

    data class Failed(
        val reason: FinishFailure,
        val message: String,
    ) : FinishPhase

    data class Done(
        val summary: FinishedSummary,
    ) : FinishPhase
}

data class FinishState(
    val followUp: FollowUpChoice = FollowUpChoice.NotNeeded,
    /** The fee in paise; prefilled from the visit's priced procedures, editable; null for none. */
    val feePaise: Long? = null,
    val hasRxDraft: Boolean = false,
    /** Whether the draft is issued with the visit: on by default when a draft exists. */
    val issueRx: Boolean = false,
    val overrideReason: String = "",
    val outcome: FinishOutcome = FinishOutcome.SentToDesk,
    val phase: FinishPhase = FinishPhase.Editing,
)

/** Result of saving the Rx draft before the finish. */
sealed interface RxSave {
    /** Saved; [draftId] is null when there is no draft. */
    data class Saved(
        val draftId: String?,
    ) : RxSave

    data object Failed : RxSave
}
