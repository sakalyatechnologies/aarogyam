package com.aarogyam.staff.android.ui.live

import androidx.annotation.StringRes
import com.aarogyam.staff.android.R

/** The banner line for a notification kind: its string and whether it takes the token number; null for a kind with no banner. */
data class LiveLine(
    @StringRes val res: Int,
    val usesToken: Boolean,
)

/** Pure helpers for the live banner (iOS `LiveV10Logic`). Only the token number is used, never a patient's name. */
object LiveLogic {
    fun line(
        kind: String,
        token: Int?,
    ): LiveLine? {
        val withToken = token != null
        return when (kind) {
            "patient_waiting" -> {
                LiveLine(
                    if (withToken) R.string.sh_lv10_waiting else R.string.sh_lv10_waiting_nonumber,
                    withToken,
                )
            }

            "send_in" -> {
                LiveLine(
                    if (withToken) R.string.sh_lv10_sendin else R.string.sh_lv10_sendin_nonumber,
                    withToken,
                )
            }

            "collect_payment" -> {
                LiveLine(
                    if (withToken) R.string.sh_lv10_collect else R.string.sh_lv10_collect_nonumber,
                    withToken,
                )
            }

            else -> {
                null
            }
        }
    }
}
