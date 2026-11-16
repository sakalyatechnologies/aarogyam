package com.aarogyam.staff.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import com.aarogyam.staff.android.R

/** "5 days", for a prescription line's duration. */
@Composable
internal fun daysText(count: Int): String = pluralStringResource(R.plurals.rx_days, count, count)
