package com.aarogyam.staff.history

import com.aarogyam.staff.api.model.Attachment
import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.Note
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.Procedure
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import kotlinx.datetime.TimeZone

/** A procedure of the visit; [feePaise] is null without `billing.read` or when no price was set. */
data class VisitProcedure(
    val id: String,
    val name: String,
    val tooth: Int?,
    val done: Boolean,
    val feePaise: Long?,
)

/** The note text of the visit grouped as S, O, A and P; each list keeps the notes' order and skips empty sections. */
data class VisitNotes(
    val subjective: List<String>,
    val objective: List<String>,
    val assessment: List<String>,
    val plan: List<String>,
    /** Who signed the first signed note, or null while everything is a draft. */
    val signedBy: String?,
) {
    val isEmpty: Boolean get() = subjective.isEmpty() && objective.isEmpty() && assessment.isEmpty() && plan.isEmpty()
}

data class VisitRxItem(
    val name: String?,
    val strength: String?,
    val form: String?,
    val dose: String?,
    val frequency: String?,
    val timing: String?,
    val durationDays: Int?,
)

data class VisitRx(
    val id: String,
    val number: String?,
    val issued: Boolean,
    val items: List<VisitRxItem>,
)

data class VisitFile(
    val id: String,
    val kind: String,
    val mimeType: String,
    val label: String?,
    val tooth: Int?,
)

/** The bill raised in this visit; null when the role lacks `billing.read` or no bill was issued. */
data class VisitBill(
    val id: String,
    val number: String?,
    val totalPaise: Long,
    val paidPaise: Long,
    val balancePaise: Long,
)

/** Everything the visit sheet draws. Money is null when [moneyVisible] is false. */
data class VisitDetailView(
    val id: String,
    val number: String,
    val at: ClinicMoment?,
    val clinician: String,
    val title: String?,
    val open: Boolean,
    val procedures: List<VisitProcedure>,
    val notes: VisitNotes,
    val rx: VisitRx?,
    val files: List<VisitFile>,
    val bill: VisitBill?,
    val moneyVisible: Boolean,
)

private const val ERROR_STATUS = "entered_in_error"

internal fun toDetailView(
    visit: Visit,
    notes: List<Note>,
    procedures: List<Procedure>,
    files: List<Attachment>,
    rx: Prescription?,
    bill: Invoice?,
    moneyVisible: Boolean,
    zone: TimeZone,
) = VisitDetailView(
    id = visit.id,
    number = visit.number,
    at = moment(visit.startedAt, zone),
    clinician = visit.clinician.name,
    title = visit.chiefComplaint,
    open = visit.status == "open",
    procedures =
        procedures.filter { it.status != ERROR_STATUS }.map {
            VisitProcedure(it.id, it.name, it.tooth, it.status == "done", if (moneyVisible) it.pricePaise else null)
        },
    notes = groupNotes(notes),
    rx = rx?.toVisitRx(),
    files = files.map { VisitFile(it.id, it.kind, it.mimeType, it.label, it.tooth) },
    bill =
        if (moneyVisible && bill != null) {
            VisitBill(bill.id, bill.number, bill.totalPaise, bill.paidPaise, bill.balancePaise)
        } else {
            null
        },
    moneyVisible = moneyVisible,
)

internal fun groupNotes(notes: List<Note>): VisitNotes {
    val live = notes.filter { it.status != ERROR_STATUS }

    fun texts(pick: (Note) -> String?) = live.mapNotNull(pick).map { it.trim() }.filter { it.isNotEmpty() }
    return VisitNotes(
        subjective = texts { it.sections.subjective },
        objective = texts { it.sections.objective },
        assessment = texts { it.sections.assessment },
        plan = texts { it.sections.plan },
        signedBy = live.firstOrNull { it.status == "signed" }?.author?.name,
    )
}

private fun Prescription.toVisitRx() =
    VisitRx(
        id = id,
        number = number,
        issued = status == "issued",
        items =
            items.map {
                VisitRxItem(
                    it.drugName,
                    it.strength,
                    it.form,
                    it.dose,
                    it.frequency,
                    it.timing,
                    it.durationDays,
                )
            },
    )
