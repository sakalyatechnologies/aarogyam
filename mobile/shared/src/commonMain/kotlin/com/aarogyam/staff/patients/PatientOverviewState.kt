package com.aarogyam.staff.patients

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.chart.Finding

/** How far along a treatment is; each platform maps it to a pill. */
enum class TxStatus { Done, InProgress, Planned, Watch }

/** One tooth on one day: [finding] is the most telling entry, [procedure] its label when one was chosen. */
data class TreatmentRow(
    val tooth: Int,
    val date: ClinicMoment,
    val finding: Finding,
    val procedure: String?,
    val status: TxStatus,
)

data class LastVisitView(
    val id: String,
    val number: String,
    val at: ClinicMoment,
    val clinician: String,
    val reason: String?,
)

enum class MediaKind { Xray, Photo }

data class MediaView(
    val id: String,
    val kind: MediaKind,
    val label: String?,
    val tooth: Int?,
    val at: ClinicMoment?,
)

/** Visits, what was paid and what is still due, in paise. Only roles with `billing.read` get one. */
data class MoneySummary(
    val visits: Int,
    val paidPaise: Long,
    val remainingPaise: Long,
)

/** What the Overview tab and the header money strip draw. */
sealed interface OverviewState {
    data object Loading : OverviewState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : OverviewState

    /** The load failed; [ScreenError.Offline] is the offline case. */
    data class Failed(
        val error: ScreenError,
    ) : OverviewState

    data class Loaded(
        /** Newest day first, then by tooth. */
        val treatments: List<TreatmentRow>,
        /** Allergies and conditions from the patient record. */
        val alerts: FlagsView,
        val lastVisit: LastVisitView?,
        /** X-rays and photos, newest first. */
        val media: List<MediaView>,
        /** Null when the role lacks `billing.read`: show no strip at all. */
        val money: MoneySummary?,
        /** The strip shows amounts; starts false and is never saved. */
        val moneyShown: Boolean,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : OverviewState
}
