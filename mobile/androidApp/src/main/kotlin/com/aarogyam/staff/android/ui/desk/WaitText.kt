package com.aarogyam.staff.android.ui.desk

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.android.R
import com.aarogyam.staff.desk.WaitKind
import com.aarogyam.staff.desk.WaitText

/** The shared wait wording ("Just arrived", "N min", "H h M min") in the device language. */
@Composable
fun waitString(text: WaitText): String =
    when (text.kind) {
        WaitKind.JustArrived -> stringResource(R.string.dk_wait_just_arrived)
        WaitKind.Minutes -> stringResource(R.string.dk_wait_min, text.minutes)
        WaitKind.HoursMinutes -> stringResource(R.string.dk_wait_h_min, text.hours, text.minutes)
    }
