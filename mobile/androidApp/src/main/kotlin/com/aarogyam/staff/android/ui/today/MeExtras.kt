package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.today.MeView
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The month's revenue against the clinic's target, on the me card; nothing when no target is set. */
@Composable
internal fun MonthTarget(
    me: MeView,
    ink: Color,
) {
    val target = me.monthTargetPaise?.takeIf { it > 0 } ?: return
    val collected = me.monthCollectedPaise ?: return
    val share = (collected.toFloat() / target).coerceIn(0f, 1f)
    val label = SkTypography.caption.copy(fontWeight = FontWeight.Bold)
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(stringResource(R.string.v7_me_target), style = label, color = ink.copy(alpha = INK_ALPHA))
            Text(
                stringResource(R.string.v7_me_target_value, collected.rupees(), target.rupees()),
                style = label,
                color = ink.copy(alpha = INK_ALPHA),
            )
        }
        val track = RoundedCornerShape(TRACK_DP.dp)
        Box(
            Modifier
                .fillMaxWidth()
                .height(TRACK_DP.dp)
                .clip(track)
                .background(Color.White.copy(alpha = GLASS_ALPHA)),
        ) {
            Box(Modifier.fillMaxWidth(share).height(TRACK_DP.dp).background(SkTheme.palette.primary.color, track))
        }
    }
}

/** "N cycles today" with, for a member who may log them, a "Log a cycle" chip beside it. */
@Composable
internal fun CycleChips(
    count: Int,
    ink: Color,
    onLog: (() -> Unit)?,
) {
    val text = SkTypography.caption.copy(fontWeight = FontWeight.Bold)
    val bg = Color.White.copy(alpha = CHIP_BG)
    if (count > 0 || onLog != null) {
        Text(
            LocalResources.current.getQuantityString(R.plurals.v7_me_cycles, count, count),
            style = text,
            color = ink,
            modifier = Modifier.background(bg, CircleShape).padding(horizontal = 9.dp, vertical = 5.dp),
        )
    }
    if (onLog != null) {
        Text(
            stringResource(R.string.v7_me_cycle_log),
            style = text,
            color = SkTheme.palette.onPrimary.color,
            modifier =
                Modifier
                    .clip(CircleShape)
                    .background(SkTheme.palette.primary.color, CircleShape)
                    .clickable(role = Role.Button, onClick = onLog)
                    .padding(horizontal = 9.dp, vertical = 5.dp),
        )
    }
}

private const val TRACK_DP = 8
private const val INK_ALPHA = 0.85f
private const val GLASS_ALPHA = 0.55f
private const val CHIP_BG = 0.6f
