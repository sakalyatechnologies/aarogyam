package com.aarogyam.staff.prescriptions

/** Smallest and largest course the composer allows, in days. */
const val RX_MIN_DAYS = 1
const val RX_MAX_DAYS = 90

/** Which part of the day a dose slot is. */
enum class DoseSlot { Morning, Afternoon, Night }

/**
 * Units taken morning, afternoon and night, stored as halves so no float is needed: 0, 1 (½),
 * 2 (one) or 4 (two). A slot only ever moves through those steps.
 */
data class RxDose(
    val morning: Int,
    val afternoon: Int,
    val night: Int,
) {
    val isEmpty: Boolean get() = morning == 0 && afternoon == 0 && night == 0

    /** Halves taken in one day. */
    val dailyHalves: Int get() = morning + afternoon + night

    fun halves(slot: DoseSlot): Int =
        when (slot) {
            DoseSlot.Morning -> morning
            DoseSlot.Afternoon -> afternoon
            DoseSlot.Night -> night
        }

    /** Taps one slot: 0 to ½ to 1 to 2 and back to 0. */
    fun cycle(slot: DoseSlot): RxDose =
        when (slot) {
            DoseSlot.Morning -> copy(morning = nextStep(morning))
            DoseSlot.Afternoon -> copy(afternoon = nextStep(afternoon))
            DoseSlot.Night -> copy(night = nextStep(night))
        }

    /** The API's frequency text, such as `1-0-½`. */
    fun format(): String = listOf(morning, afternoon, night).joinToString("-") { stepText(it) }

    companion object {
        val STEPS: List<Int> = listOf(0, 1, 2, 4)

        /** Null when [text] is not three known steps (`1-0-1`, `½-0-½`, `0.5-0-1`); never throws. */
        fun parse(text: String?): RxDose? {
            val parts = text?.trim()?.split('-')?.map { it.trim() } ?: return null
            if (parts.size != 3) return null
            val halves = parts.map { halvesOf(it) ?: return null }
            return RxDose(halves[0], halves[1], halves[2])
        }
    }
}

private fun nextStep(halves: Int): Int {
    val at = RxDose.STEPS.indexOf(halves)
    return RxDose.STEPS[(at + 1) % RxDose.STEPS.size]
}

private fun halvesOf(token: String): Int? =
    when (token) {
        "0" -> 0
        "½", "0.5", ".5", "1/2" -> 1
        "1", "1.0" -> 2
        "2", "2.0" -> 4
        else -> null
    }

private fun stepText(halves: Int): String =
    when (halves) {
        0 -> "0"
        1 -> "½"
        2 -> "1"
        4 -> "2"
        else -> (halves / 2.0).toString()
    }

/** Whether [form] is counted in whole pieces; liquids, rinses and gels are not. */
internal fun isCountedForm(form: String?): Boolean =
    when (form?.trim()?.lowercase()) {
        "tablet", "tablets", "tab", "capsule", "capsules", "cap" -> true
        else -> false
    }

/**
 * Tablets or capsules to dispense for [days] at [dose], rounded up; null for forms that are not
 * counted (liquid, rinse, gel, unknown). For an SOS line this is the most that could be taken.
 */
fun unitsTotal(
    dose: RxDose,
    days: Int,
    form: String?,
): Int? {
    if (!isCountedForm(form)) return null
    val halves = dose.dailyHalves * days.coerceAtLeast(0)
    return (halves + 1) / 2
}

/** The API's `timing` strings, one per case. */
enum class RxTiming(
    val api: String,
) {
    BeforeFood("before_food"),
    AfterFood("after_food"),
    EmptyStomach("empty_stomach"),
    Bedtime("bedtime"),
    Sos("sos"),
    AsDirected("as_directed"),
    ;

    companion object {
        /** Null for a missing or unknown string. */
        fun fromApi(text: String?): RxTiming? = entries.firstOrNull { it.api == text }
    }
}
