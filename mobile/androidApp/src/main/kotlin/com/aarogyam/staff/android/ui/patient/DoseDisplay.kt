package com.aarogyam.staff.android.ui.patient

import com.aarogyam.staff.prescriptions.DoseSlot
import com.aarogyam.staff.prescriptions.RxDose
import com.aarogyam.staff.prescriptions.RxTiming
import com.aarogyam.staff.prescriptions.unitsTotal

/** One of the morning, afternoon and night cells. */
data class DoseCell(
    val slot: DoseSlot,
    val value: String,
    val on: Boolean,
)

/** A medicine's morning, afternoon and night cells with the days and the total, from the shared dosing model. */
data class DoseDisplay(
    val cells: List<DoseCell>,
    val frequency: String,
    /** The recognised timing, or null; [rawTiming] is what the server sent when it is not one we know. */
    val timing: RxTiming?,
    val rawTiming: String?,
    val days: Int?,
    val total: Int?,
    /** An SOS line: the total is the most that could be taken. */
    val upTo: Boolean,
    val form: String?,
) {
    companion object {
        fun make(
            frequency: String?,
            timing: String?,
            days: Int?,
            form: String?,
        ): DoseDisplay {
            val dose = RxDose.parse(frequency)
            val cells =
                DoseSlot.entries.map { slot ->
                    if (dose == null) {
                        DoseCell(slot, "–", false)
                    } else {
                        val halves = dose.halves(slot)
                        DoseCell(slot, halvesText(halves), halves > 0)
                    }
                }
            val known = RxTiming.fromApi(timing)
            val total = if (dose != null && days != null) unitsTotal(dose, days, form) else null
            return DoseDisplay(
                cells = cells,
                frequency = dose?.format() ?: frequency.orEmpty(),
                timing = known,
                rawTiming = if (known == null) timing else null,
                days = days,
                total = total,
                upTo = known == RxTiming.Sos,
                form = form,
            )
        }

        /** Halves as tablets: `0`, `½`, `1`, `1½`. */
        fun halvesText(halves: Int): String {
            val whole = halves / 2
            if (halves % 2 == 0) return whole.toString()
            return if (whole == 0) "½" else "$whole½"
        }
    }
}
