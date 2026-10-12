package com.aarogyam.staff.patients

import com.aarogyam.staff.api.model.Attachment
import com.aarogyam.staff.api.model.ChartEntry
import com.aarogyam.staff.api.model.ClinicalFlags
import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.chart.Finding
import kotlinx.datetime.TimeZone

/** The status a finding means; a root canal is in progress until the tooth has a crown. */
internal fun statusOf(
    finding: Finding,
    crowned: Boolean,
): TxStatus =
    when (finding) {
        Finding.Watch -> TxStatus.Watch
        Finding.Caries, Finding.Fractured -> TxStatus.Planned
        Finding.RootCanal -> if (crowned) TxStatus.Done else TxStatus.InProgress
        else -> TxStatus.Done
    }

private val URGENCY = listOf(TxStatus.InProgress, TxStatus.Planned, TxStatus.Watch, TxStatus.Done)

/** One row per tooth and day from the current entries; sound and unknown findings are left out. */
internal fun treatmentsOf(
    current: List<ChartEntry>,
    zone: TimeZone,
): List<TreatmentRow> {
    val live = current.filter { it.status == "current" }
    val crowned = live.filter { it.finding == "crown" }.map { it.tooth }.toSet()
    val rows =
        live.mapNotNull { e ->
            val finding = Finding.of(e.finding)?.takeIf { it != Finding.Sound } ?: return@mapNotNull null
            val at = moment(e.effectiveAt, zone) ?: return@mapNotNull null
            TreatmentRow(e.tooth, at, finding, e.procedure?.label, statusOf(finding, e.tooth in crowned))
        }
    return rows
        .groupBy { it.tooth to it.date.date }
        .values
        .map { group -> group.minBy { URGENCY.indexOf(it.status) } }
        .sortedWith(compareByDescending<TreatmentRow> { it.date.date }.thenBy { it.tooth })
}

internal fun flagsOf(flags: ClinicalFlags) =
    FlagsView(
        allergyCount = flags.allergyCount,
        severeAllergy = flags.severeAllergy,
        conditionCount = flags.conditionCount,
        detailsHidden = flags.detailsHidden,
        allergies =
            flags.allergies.map {
                val severity =
                    Severity.entries.firstOrNull { s -> s.name.lowercase() == it.severity } ?: Severity.Unknown
                AllergyView(it.substance, severity, it.reaction)
            },
        conditions = flags.conditions.map { it.displayText },
    )

internal fun lastVisitOf(
    visits: List<Visit>?,
    zone: TimeZone,
): LastVisitView? =
    visits?.firstNotNullOfOrNull { v ->
        moment(v.startedAt, zone)?.let { LastVisitView(v.id, v.number, it, v.clinician.name, v.chiefComplaint) }
    }

internal fun mediaOf(
    files: List<Attachment>,
    zone: TimeZone,
): List<MediaView> =
    files.mapNotNull {
        val kind = MediaKind.entries.firstOrNull { k -> k.name.lowercase() == it.kind } ?: return@mapNotNull null
        MediaView(it.id, kind, it.label, it.tooth, moment(it.takenAt ?: it.createdAt, zone))
    }

/** Paid and still due over issued bills; drafts and voided ones count for nothing. */
internal fun moneyOf(
    invoices: List<Invoice>,
    visits: Int,
): MoneySummary {
    val issued = invoices.filter { it.status == "issued" }
    return MoneySummary(visits, issued.sumOf { it.paidPaise }, issued.sumOf { it.balancePaise })
}
