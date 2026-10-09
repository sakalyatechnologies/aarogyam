package com.aarogyam.staff.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.android.R
import com.sakalya.mobile.designcompose.SkEmptyState

/** A tab whose v7 page lands in a later update, titled [title]. */
@Composable
fun ComingSoon(title: Int) {
    SkEmptyState(stringResource(title), stringResource(R.string.v7_soon))
}
