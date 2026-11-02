package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.model.QuickMedicineSet
import com.aarogyam.staff.api.model.QuickSetMedicine

/** One medicine-set chip in the prescription card: tap to add all its medicines. */
data class RxSetChip(
    val id: String,
    val label: String,
    val count: Int,
)

internal const val SET_DEFAULT_DAYS = 5

internal fun QuickMedicineSet.toChip() = RxSetChip(id, label, items.size)

/** A set medicine as a free-text line (no catalogue id). The set's `instructions` have no line field and are dropped. */
internal fun QuickSetMedicine.toLine(key: Int) =
    RxLine(
        key = key,
        drugId = null,
        name = drugName,
        detail = listOf(strength, form).filter { it.isNotBlank() }.joinToString(" "),
        dose = dose,
        frequency = frequency,
        durationDays = durationDays ?: SET_DEFAULT_DAYS,
        timing = timing,
    )

/** The set's medicines whose names are not already in [existing] (case-insensitive), numbered from [firstKey]. */
internal fun QuickMedicineSet.newLines(
    existing: List<RxLine>,
    firstKey: Int,
): List<RxLine> {
    val seen = existing.map { it.name.trim().lowercase() }.toMutableSet()
    return items
        .filter { seen.add(it.drugName.trim().lowercase()) }
        .mapIndexed { index, item -> item.toLine(firstKey + index) }
}
