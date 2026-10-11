package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.model.RxItem

/**
 * One medicine while it is being edited inline. A frequency the app cannot read stays in
 * [rawFrequency] (and an unknown timing in [rawTiming]) so it goes back to the API unchanged.
 */
data class RxLineDraft(
    val drugId: String? = null,
    val drugName: String? = null,
    val strength: String? = null,
    val form: String? = null,
    val dosage: String? = null,
    val dose: RxDose? = null,
    val rawFrequency: String? = null,
    val days: Int = 5,
    val timing: RxTiming? = null,
    val rawTiming: String? = null,
    val instructions: String? = null,
) {
    val isSos: Boolean get() = timing == RxTiming.Sos

    /** Days in range, and either a real dose (an SOS line may have none) or text kept as typed. */
    val isValid: Boolean
        get() {
            val doseOk = dose?.isEmpty?.not() ?: (isSos || !rawFrequency.isNullOrBlank())
            return days in RX_MIN_DAYS..RX_MAX_DAYS && doseOk
        }

    /** What to show or send as the frequency. */
    val frequencyText: String? get() = dose?.format() ?: rawFrequency

    /** Pieces to dispense, or null when the form is not counted or the dose is not readable. */
    val total: Int? get() = dose?.let { unitsTotal(it, days, form) }

    fun withDays(value: Int): RxLineDraft = copy(days = value.coerceIn(RX_MIN_DAYS, RX_MAX_DAYS))

    fun cycled(slot: DoseSlot): RxLineDraft = copy(dose = (dose ?: RxDose(0, 0, 0)).cycle(slot), rawFrequency = null)

    fun toItem(): RxItem =
        RxItem(
            drugId = drugId,
            drugName = drugName,
            dose = dosage,
            frequency = frequencyText,
            durationDays = days,
            form = form,
            instructions = instructions,
            strength = strength,
            timing = timing?.api ?: rawTiming,
        )

    companion object {
        fun fromItem(item: RxItem): RxLineDraft {
            val parsed = RxDose.parse(item.frequency)
            val timing = RxTiming.fromApi(item.timing)
            return RxLineDraft(
                drugId = item.drugId,
                drugName = item.drugName,
                strength = item.strength,
                form = item.form,
                dosage = item.dose,
                dose = parsed,
                rawFrequency = if (parsed == null) item.frequency else null,
                days = item.durationDays ?: 5,
                timing = timing,
                rawTiming = if (timing == null) item.timing else null,
                instructions = item.instructions,
            )
        }
    }
}
