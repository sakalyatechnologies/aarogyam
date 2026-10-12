package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.model.Drug
import com.aarogyam.staff.api.model.RxItem
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Severity

internal fun Drug.toView() =
    DrugView(
        id = id,
        name = genericName,
        brand = brandName,
        strength = strength,
        form = form,
        defaultDose = defaultDose,
        defaultFrequency = defaultFrequency,
        defaultDays = defaultDurationDays,
        defaultTiming = defaultTiming,
    )

internal fun RxLine.toItem() =
    RxItem(
        drugId = drugId,
        drugName = if (drugId == null) name else null,
        dose = dose,
        frequency = frequency,
        durationDays = durationDays,
        timing = timing,
    )

internal fun RxItem.toLine(key: Int): RxLine? {
    val name = drugName?.takeIf { it.isNotBlank() } ?: return null
    return RxLine(
        key = key,
        drugId = drugId,
        name = name,
        detail = listOfNotNull(strength, form).joinToString(" "),
        dose = dose.orEmpty(),
        frequency = frequency.orEmpty(),
        durationDays = durationDays ?: 5,
        timing = timing,
    )
}

/** Name matches only (the clinic's check also knows classes such as penicillins). */
internal fun warningsFor(
    lines: List<RxLine>,
    allergies: List<AllergyView>,
): List<AllergyWarning> =
    lines.flatMap { line ->
        val drug = line.name.lowercase()
        allergies.mapNotNull { allergy ->
            val substance = allergy.substance.trim().lowercase()
            val matches = substance.length >= 3 && (drug.contains(substance) || substance.contains(drug))
            if (matches) AllergyWarning(line.key, line.name, allergy.substance.trim(), allergy.severity) else null
        }
    }

internal const val ALLERGY_ALERTS = "allergy_alerts"

/** The API's alert severity: `info`, `caution` or `serious`. */
internal fun severityOf(text: String): Severity =
    when (text) {
        "serious" -> Severity.Severe
        "caution" -> Severity.Moderate
        "info" -> Severity.Mild
        else -> Severity.Unknown
    }
