package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError

/** What the Chart tab draws. */
sealed interface ChartState {
    data object Loading : ChartState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : ChartState

    data class Failed(
        val error: ScreenError,
    ) : ChartState

    data class Loaded(
        val dentition: Dentition,
        /** The shown dentition's arches, left to right as the clinician faces the patient. */
        val upper: List<ToothView>,
        val lower: List<ToothView>,
        /** Teeth of the shown dentition with a finding other than sound. */
        val needsCare: Int,
        val selected: ToothSelection?,
        /** "Select several" is on: taps add and remove teeth from [group]. */
        val several: Boolean,
        /** The teeth picked with "Select several", in FDI order; a finding is recorded on all of them. */
        val group: List<Int>,
        /** Procedures and materials to offer, loaded with the chart: seeded, then the clinic's own. */
        val terms: List<TermView>,
        /** A new term is on its way to the server. */
        val addingTerm: Boolean,
        /** The term just added (or found) for "Add new"; the record sheet picks it, then calls `consumeAddedTerm`. */
        val addedTerm: TermView?,
        /** The last "Add new" failed. */
        val termError: ScreenError?,
        /** The role holds `clinical.write`; without it the record actions are hidden. */
        val canRecord: Boolean,
        /** A finding is on its way to the server (and already drawn). */
        val saving: Boolean,
        /** The last finding could not be saved and was taken off the chart again. */
        val recordError: ScreenError?,
        val refreshing: Boolean,
        /** A refresh failed; the chart on screen is the last one loaded. */
        val error: ScreenError?,
    ) : ChartState {
        /** How many teeth the shown dentition has. */
        val total: Int get() = upper.size + lower.size
    }
}
