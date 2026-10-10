package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.NotificationsStateHolder
import com.sakalya.mobile.designcompose.SkBadgeDot
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The bell's sheet: booking notifications, newest first, with "Mark all read". */
@Composable
fun NotificationsSheet(
    holder: NotificationsStateHolder,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    SkBottomSheet(stringResource(R.string.v7_notifications), onDismiss) {
        when (val s = state) {
            ListState.Loading -> {
                LoadingIndicator()
            }

            ListState.NotAllowed -> {
                Text(
                    stringResource(R.string.today_not_allowed_message),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                )
            }

            is ListState.Failed -> {
                Text(stringResource(s.error.message()), style = SkTypography.footnote, color = p.error.color)
            }

            is ListState.Loaded -> {
                if (s.items.isEmpty()) {
                    Text(
                        stringResource(R.string.v7_notifications_none),
                        style = SkTypography.bodyText,
                        color = p.onSurfaceVariant.color,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        s.items.take(MAX).forEach { row ->
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (!row.read) SkBadgeDot()
                                Text(
                                    stringResource(kindLabel(row.kind)),
                                    style = SkTypography.bodyStrong,
                                    color = p.onSurface.color,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                        if (s.items.any { !it.read }) {
                            SkButton(
                                stringResource(R.string.v7_notifications_read_all),
                                holder::readAll,
                                Modifier.fillMaxWidth().padding(top = 4.dp),
                                variant = SkButtonVariant.Secondary,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun kindLabel(kind: String): Int =
    when (kind) {
        "booking_requested" -> R.string.v7_notif_requested
        "booking_confirmed_auto" -> R.string.v7_notif_confirmed
        "booking_cancelled_by_patient" -> R.string.v7_notif_cancelled
        else -> R.string.v7_notifications
    }

private const val MAX = 30
