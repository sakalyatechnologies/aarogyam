package com.aarogyam.staff.history

import com.aarogyam.staff.api.model.HistoryBill
import com.aarogyam.staff.api.model.HistoryVisit
import com.aarogyam.staff.patients.moment
import kotlinx.datetime.TimeZone

/** What happened to a tooth in a visit, as the History card shows it. */
enum class ToothWorkKind {
    Found,
    Planned,
    InProgress,
    Done,
    Elsewhere,
    ;

    companion object {
        /** The API's `work` word; an unknown word reads as [Found], the most neutral. */
        fun of(wire: String): ToothWorkKind =
            when (wire) {
                "planned" -> Planned
                "in_progress" -> InProgress
                "done" -> Done
                "elsewhere" -> Elsewhere
                else -> Found
            }
    }
}

/** One tooth line of a visit: the FDI number, what was done, and the procedure's or finding's label. */
data class ToothWork(
    val tooth: Int,
    val kind: ToothWorkKind,
    val label: String?,
)

/** A treatment plan touched by the visit; [status] is the API's word (`proposed`, `accepted`…). */
data class VisitPlan(
    val id: String,
    val title: String,
    val status: String,
)

/** One page of History cards; [nextCursor] is null on the last page. */
internal data class HistoryPage(
    val rows: List<VisitRow>,
    val nextCursor: String?,
)

/** Maps a `/history` visit to a card; null when its start time can't be read. */
internal fun HistoryVisit.toRow(zone: TimeZone): VisitRow? {
    val at = moment(startedAt, zone) ?: return null
    val work =
        teeth
            .filter { it.tooth > 0 }
            .map { ToothWork(it.tooth, ToothWorkKind.of(it.work), (it.label ?: it.finding)?.clean()) }
    val due =
        bills?.let { list ->
            list.filter(HistoryBill::counts).sumOf { (it.totalPaise - it.paidPaise).coerceAtLeast(0) }
        }
    return VisitRow(
        id = id,
        number = number,
        at = at,
        clinician = clinician.name,
        title = chiefComplaint,
        hasNotes = counts.notes > 0,
        hasRx = medicines.isNotEmpty(),
        hasPhotos = imageCount > 0,
        bill =
            when {
                bills == null || bills.none(HistoryBill::counts) -> BillState.None
                due == 0L -> BillState.Paid
                else -> BillState.Due
            },
        open = status == "open",
        teeth = work.map { it.tooth }.distinct().sorted(),
        duePaise = due?.takeIf { bills.orEmpty().any(HistoryBill::counts) },
        titleSource =
            VisitTitleSource(
                complaint = chiefComplaint?.clean(),
                firstProcedure = work.firstOrNull { it.kind != ToothWorkKind.Found }?.label,
                kind = null,
            ),
        noteLine = noteFirstLine?.clean(),
        medicines = medicines.mapNotNull { it.clean() },
        photoCount = imageCount,
        work = work,
        plans = plans.map { VisitPlan(it.id, it.title, it.status) },
    )
}

/** A void or cancelled bill is not money owed or paid. */
private fun HistoryBill.counts(): Boolean = status != "void" && status != "cancelled"

private fun String.clean(): String? = trim().takeIf(String::isNotEmpty)
