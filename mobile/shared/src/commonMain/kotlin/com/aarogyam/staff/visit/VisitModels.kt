package com.aarogyam.staff.visit

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.CloseQueueStatus
import com.aarogyam.staff.api.model.FinishRequest
import com.aarogyam.staff.device.DictationLanguage
import kotlin.time.Instant

/** Where the note stands on the server. */
enum class NoteSave { Empty, Unsaved, Saving, Saved, Signed, Failed }

/** The Visit screen's data. Clinical text is for the screen only, never for logs. */
data class VisitView(
    val visitId: String,
    val number: String,
    val startedAt: Instant?,
    val bullets: List<Bullet> = emptyList(),
    val save: NoteSave = NoteSave.Empty,
    /** Words the recogniser is still hearing; becomes a bullet when final. */
    val liveText: String? = null,
    val listening: DictationLanguage? = null,
    val closing: Boolean = false,
    val closed: Boolean = false,
    /** The fee typed at close, in paise, (sent with the close). */
    val pendingFeePaise: Long? = null,
    val error: ScreenError? = null,
    /** The note is saved on this phone and not yet on the server ("Saved, will send"). */
    val noteSync: Boolean = false,
    /** The close is saved on this phone and not yet on the server. */
    val closeSync: Boolean = false,
    /** Writes of this visit (notes, procedures, close) still waiting to be sent. */
    val unsent: Int = 0,
)

sealed interface VisitState {
    data object Starting : VisitState

    /** The role lacks `clinical.write`. */
    data object NotAllowed : VisitState

    data class Failed(
        val error: ScreenError,
    ) : VisitState

    data class Open(
        val view: VisitView,
    ) : VisitState
}

/**
 * The finish body: a follow-up (`YYYY-MM-DD`), its reason or the bill note, and a fee, all optional.
 * The token always goes to `ready_to_bill` (plan D8), so the desk collects and no bill is lost.
 */
internal fun finishBody(
    followUpOn: String?,
    note: String?,
    feePaise: Long?,
): FinishRequest =
    FinishRequest(
        followUpOn = followUpOn,
        note = note?.takeIf { followUpOn != null || feePaise != null },
        feePaise = feePaise,
        queueStatus = CloseQueueStatus.READY_TO_BILL,
    )
