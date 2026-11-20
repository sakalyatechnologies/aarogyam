package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.prescriptions.RxSheetState
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * "Allergy warning": the clinic's check while medicines are added. Danger-toned when anything is
 * serious, else warning-toned. It never blocks Issue, which checks again.
 */
@Composable
internal fun RxCheckBanner(
    state: RxSheetState,
    modifier: Modifier = Modifier,
) {
    if (!state.showsCheck) return
    val colors = SkTheme.colors
    val ink = if (state.checkSerious) colors.dangerText.color else colors.warningText.color
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Spacing.L.dp))
            .background(if (state.checkSerious) colors.dangerSoft.color else colors.warningSoft.color)
            .padding(Spacing.M.dp)
            .semantics { liveRegion = LiveRegionMode.Assertive },
        verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp),
    ) {
        Text(stringResource(R.string.rx_check_title), style = SkTypography.bodyStrong, color = ink)
        state.checkAlerts.forEach { Text(it.message, style = SkTypography.footnote, color = ink) }
    }
}
