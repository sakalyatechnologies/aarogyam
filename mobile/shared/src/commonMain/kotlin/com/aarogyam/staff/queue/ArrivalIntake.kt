package com.aarogyam.staff.queue

import com.aarogyam.staff.api.model.Arrival
import com.aarogyam.staff.api.model.CheckInChoice
import com.aarogyam.staff.api.model.IntakeOptions

/** A line of the case-paper summary on the accept review; each platform names it. */
enum class IntakeLine {
    BloodGroup,
    AltPhone,
    EmergencyContact,
    ReferredBy,
    CallTime,
    Occupation,
    HeardVia,
    FamilyDoctor,
    FamilyDoctorAddress,
    HealthOther,
    Allergies,
    Pregnant,
    DueDate,
    Nursing,
}

/** One filled line: [value] for text, or [answer] for a yes/no line. Patient data: shown on screen only, never logged. */
data class IntakeDetail(
    val line: IntakeLine,
    val value: String = "",
    val answer: Boolean? = null,
)

/** What the patient told the QR form beyond the basics, read-only. [health] are the ticked checklist labels. */
data class ArrivalIntake(
    val lines: List<IntakeDetail> = emptyList(),
    val health: List<String> = emptyList(),
) {
    val isEmpty: Boolean get() = lines.isEmpty() && health.isEmpty()
}

/** The summary of [Arrival.intake], [Arrival.health] and [Arrival.allergiesText]; [options] turn codes into words. */
internal fun Arrival.intakeSummary(options: IntakeOptions?): ArrivalIntake {
    val i = intake
    val lines =
        buildList {
            fun add(
                line: IntakeLine,
                value: String?,
            ) {
                value?.trim()?.takeIf { it.isNotEmpty() }?.let { add(IntakeDetail(line, it)) }
            }
            add(IntakeLine.BloodGroup, i?.bloodGroup)
            add(IntakeLine.AltPhone, i?.altPhone)
            add(
                IntakeLine.EmergencyContact,
                listOfNotNull(i?.emergencyContactName, i?.emergencyContactPhone).joinToString(", "),
            )
            add(IntakeLine.ReferredBy, i?.referredBy)
            add(IntakeLine.CallTime, i?.callTime?.let { wordFor(options?.callTimes, it) })
            add(IntakeLine.Occupation, i?.occupation)
            add(
                IntakeLine.HeardVia,
                listOfNotNull(
                    i?.heardVia?.let {
                        wordFor(options?.heardVia, it)
                    },
                    i?.heardViaText,
                ).joinToString(": "),
            )
            add(IntakeLine.FamilyDoctor, listOfNotNull(i?.familyDoctorName, i?.familyDoctorPhone).joinToString(", "))
            add(IntakeLine.FamilyDoctorAddress, i?.familyDoctorAddress)
            add(IntakeLine.HealthOther, i?.healthOther)
            add(IntakeLine.Allergies, allergiesText)
            i?.pregnant?.let { add(IntakeDetail(IntakeLine.Pregnant, answer = it)) }
            add(IntakeLine.DueDate, i?.dueDate)
            i?.nursing?.let { add(IntakeDetail(IntakeLine.Nursing, answer = it)) }
        }
    return ArrivalIntake(lines, healthLabels)
}

private fun wordFor(
    choices: List<CheckInChoice>?,
    code: String,
): String = choices?.firstOrNull { it.code == code }?.label ?: code
