package com.aarogyam.patient.visits

import com.aarogyam.patient.api.model.PatientVisitSummary
import com.aarogyam.patient.records.MedicineView

/** A treatment done in a visit; [tooth] is the FDI number, [surfaces] such as `O`. No fee. */
data class TreatmentView(
    val name: String,
    val tooth: Int?,
    val surfaces: List<String>,
)

/** The prescription issued in a visit; dates stay ISO (`YYYY-MM-DD`) for the platform to format. */
data class VisitPrescriptionView(
    val number: String,
    val issuedOn: String,
    val medicines: List<MedicineView>,
)

/** The next follow-up; [kind] is the API's value (`follow_up`, `cleaning`), for platform copy. */
data class FollowUpView(
    val dueOn: String,
    val kind: String,
)

/** An earlier visit: date and title only. */
data class EarlierVisitView(
    val visitedOn: String,
    val title: String,
)

/**
 * One closed visit as the patient sees it. [visitedOn] is an ISO date; [bookingUrl] is the
 * clinic's booking page on its own host when it can be built (the fallback when there is
 * no [clinicId] for the in-app booking flow).
 */
data class VisitView(
    val id: String,
    val clinicId: String?,
    val clinicName: String,
    val number: String,
    val visitedOn: String,
    val doctorName: String?,
    val treatments: List<TreatmentView>,
    val advice: String?,
    val prescription: VisitPrescriptionView?,
    val nextFollowUp: FollowUpView?,
    val earlierVisits: List<EarlierVisitView>,
    val bookingPath: String,
    val bookingUrl: String?,
)

internal fun PatientVisitSummary.view(bookingUrl: String?): VisitView =
    VisitView(
        id = id,
        clinicId = clinicId,
        clinicName = clinicName,
        number = number,
        visitedOn = visitedOn,
        doctorName = doctorName,
        treatments = treatments.map { TreatmentView(it.name, it.tooth, it.surfaces) },
        advice = advice?.takeIf { it.isNotBlank() },
        prescription =
            prescription?.takeIf { it.items.isNotEmpty() }?.let { rx ->
                VisitPrescriptionView(
                    number = rx.number,
                    issuedOn = rx.issuedOn,
                    medicines =
                        rx.items.map {
                            MedicineView(
                                it.drugName,
                                it.strength,
                                it.dose,
                                it.frequency,
                                it.timing,
                                it.durationDays,
                                it.instructions,
                            )
                        },
                )
            },
        nextFollowUp = nextFollowUp?.let { FollowUpView(it.dueOn, it.kind) },
        earlierVisits = earlierVisits.map { EarlierVisitView(it.visitedOn, it.title) },
        bookingPath = bookingPath,
        bookingUrl = bookingUrl,
    )
