package com.aarogyam.staff.desk

/** Which wording a wait time takes; the screens map it to their translated strings. */
enum class WaitKind { JustArrived, Minutes, HoursMinutes }

/**
 * A wait time ready to show: "Just arrived" under a minute, "N min" under an hour, else "H h M min".
 * [hours] is 0 unless [kind] is [WaitKind.HoursMinutes]; [minutes] is 0 for [WaitKind.JustArrived].
 */
data class WaitText(
    val kind: WaitKind,
    val hours: Int,
    val minutes: Int,
)

/** The one formatter for every wait shown on the desk board and the doctor's waiting card. */
object WaitFormat {
    fun ofSeconds(seconds: Long): WaitText {
        val total = (seconds.coerceAtLeast(0) / 60).toInt()
        return when {
            total < 1 -> WaitText(WaitKind.JustArrived, 0, 0)
            total < 60 -> WaitText(WaitKind.Minutes, 0, total)
            else -> WaitText(WaitKind.HoursMinutes, total / 60, total % 60)
        }
    }

    fun ofMinutes(minutes: Long): WaitText = ofSeconds(minutes.coerceAtLeast(0) * 60)
}
