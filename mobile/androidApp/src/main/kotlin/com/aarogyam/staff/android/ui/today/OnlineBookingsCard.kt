package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** "N online bookings to confirm": opens Schedule's Day view with only those. */
@Composable
fun OnlineBookingsCard(
    count: Int,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = SkTheme.palette
    Text(
        if (count == 1) stringResource(R.string.appt_online_one) else stringResource(R.string.appt_online_many, count),
        style = v7(14f),
        color = p.primary.color,
        modifier =
            modifier
                .fillMaxWidth()
                .background(p.card.color, RoundedCornerShape(16.dp))
                .clickable(role = Role.Button, onClick = onOpen)
                .padding(horizontal = 14.dp, vertical = 12.dp),
    )
}
