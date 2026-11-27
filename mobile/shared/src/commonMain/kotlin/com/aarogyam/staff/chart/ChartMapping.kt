package com.aarogyam.staff.chart

import com.aarogyam.staff.api.model.ChartEntry
import com.aarogyam.staff.api.model.DentalTerm
import com.aarogyam.staff.api.model.NewChartEntry
import com.aarogyam.staff.patients.moment
import kotlinx.datetime.TimeZone

/** The current entries by tooth; unknown findings and non-FDI numbers are left out. */
internal fun teethOf(current: List<ChartEntry>): Map<Int, ToothView> {
    val teeth = mutableMapOf<Int, ToothView>()
    for (entry in current) {
        if (entry.status != "current" || Dentition.of(entry.tooth) == null) continue
        val finding = Finding.of(entry.finding) ?: continue
        val surface = Surface.of(entry.surface)
        if (entry.surface != null && surface == null) continue
        val tooth = teeth[entry.tooth] ?: ToothView(entry.tooth)
        teeth[entry.tooth] =
            if (surface == null) tooth.copy(whole = finding) else tooth.with(finding, surface)
    }
    return teeth
}

/** The chart's procedures and materials; unknown lists are left out. */
internal fun termsOf(terms: List<DentalTerm>): List<TermView> = terms.mapNotNull(::termOf)

internal fun termOf(term: DentalTerm): TermView? =
    TermKind.of(term.kind)?.let {
        TermView(term.id, it, term.label, term.own)
    }

/** Children's charts open on the primary teeth: a chart with only primary-tooth entries. */
internal fun defaultDentition(current: List<ChartEntry>): Dentition {
    val sets = current.mapNotNull { Dentition.of(it.tooth) }.toSet()
    return if (sets == setOf(Dentition.Child)) Dentition.Child else Dentition.Adult
}

/** A history row; unknown findings or statuses are left out. */
internal fun ChartEntry.toHistory(zone: TimeZone): HistoryEntryView? {
    val finding = Finding.of(finding) ?: return null
    val status =
        when (status) {
            "current" -> EntryStatus.Current
            "superseded" -> EntryStatus.Superseded
            "entered_in_error" -> EntryStatus.EnteredInError
            else -> return null
        }
    return HistoryEntryView(
        id,
        finding,
        Surface.of(surface),
        status,
        moment(effectiveAt, zone),
        note,
        procedure = procedure?.label,
        material = material?.label,
        elsewhere = elsewhere == true,
        inProgress = inProgress,
        supersedes = supersedesId,
    )
}

/**
 * What recording [finding] on [teeth] draws at once (pending) and sends: one entry per tooth and
 * surface, or per tooth for a whole-tooth finding. Procedure and material are dropped for sound.
 */
internal fun recordPlan(
    shown: Map<Int, ToothView>,
    teeth: List<Int>,
    finding: Finding,
    surfaces: List<Surface>,
    procedure: TermView?,
    material: TermView?,
    note: String?,
    /** An entry this one corrects, on any tooth or surface; it goes on the first new entry. */
    supersedes: String? = null,
    /** The work was done by another dentist; only for [ELSEWHERE_FINDINGS]. */
    elsewhere: Boolean = false,
    /** The treatment is started and not finished; with a finding other than sound. */
    inProgress: Boolean = false,
): Pair<Map<Int, ToothView>, List<NewChartEntry>> {
    val on: List<Surface?> = if (finding.wholeTooth || surfaces.isEmpty()) listOf(null) else surfaces.distinct()
    val detail = finding != Finding.Sound
    val text = note?.trim()?.takeIf { it.isNotEmpty() }
    var drawn = shown
    val entries = mutableListOf<NewChartEntry>()
    for (tooth in teeth) {
        for (surface in on) {
            drawn = drawn + (tooth to (drawn[tooth] ?: ToothView(tooth)).with(finding, surface).copy(pending = true))
            entries +=
                NewChartEntry(
                    finding = finding.wire,
                    tooth = tooth.toLong(),
                    material = material?.id?.takeIf { detail },
                    note = text,
                    procedure = procedure?.id?.takeIf { detail },
                    surface = surface?.name,
                    supersedesId = supersedes.takeIf { entries.isEmpty() },
                    elsewhere = true.takeIf { elsewhere && finding in ELSEWHERE_FINDINGS },
                    inProgress = true.takeIf { inProgress && detail },
                )
        }
    }
    return drawn to entries
}
