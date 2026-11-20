package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.desk.DeskAlert
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.tasks.TasksFormat
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.team.AlertRow
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.NotificationsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBadgeDot
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The bell's sheet: booking notifications, newest first, with "Mark all read". */
@Composable
fun NotificationsSheet(
    holder: NotificationsStateHolder,
    onOpenPatient: (String) -> Unit,
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
                        s.items.take(MAX).forEach { row -> NotificationKindRow(row, onOpenPatient) }
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

/** One bell row for any kind: the shared icon, the localized title and, for queue kinds, the token line (iOS `NotificationKindRow`). */
@Composable
private fun NotificationKindRow(
    row: AlertRow,
    onOpenPatient: (String) -> Unit,
) {
    val p = SkTheme.palette
    val detail = DeskAlert.detail(row.tokenNumber, row.patientNumber, row.doctor)
    val patient = row.patientId
    Row(
        Modifier
            .fillMaxWidth()
            .then(
                if (patient != null) {
                    Modifier
                        .sizeIn(
                            minHeight = Spacing.MIN_TOUCH_TARGET.dp,
                        ).clickable(role = Role.Button) { onOpenPatient(patient) }
                } else {
                    Modifier
                },
            ),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!row.read) SkBadgeDot()
        SkIcon(Icons.of(TasksFormat.iconFor(row.kind)), p.primary.color, size = 22.dp)
        Column(Modifier.weight(1f)) {
            Text(stringResource(kindLabel(row.kind)), style = SkTypography.bodyStrong, color = p.onSurface.color)
            detail?.let { Text(it, style = SkTypography.caption, color = p.onSurfaceVariant.color) }
        }
    }
}

/** The title string for a kind; an unknown kind is the generic "New notification". */
private fun kindLabel(kind: String): Int =
    when (kind) {
        "patient_waiting" -> R.string.sh_d9_alert_patient_waiting
        "send_in" -> R.string.sh_d9_alert_send_in
        "collect_payment" -> R.string.sh_d9_alert_collect_payment
        "booking_requested" -> R.string.v7_notif_requested
        "booking_confirmed_auto" -> R.string.v7_notif_confirmed
        "booking_cancelled_by_patient" -> R.string.v7_notif_cancelled
        "task_due" -> R.string.sh_v10_notif_task_due
        "task_reminder" -> R.string.sh_v10_notif_task_reminder
        "task_escalated" -> R.string.sh_v10_notif_task_escalated
        "time_off_requested" -> R.string.sh_v10_notif_time_off_requested
        "time_off_decided" -> R.string.sh_v10_notif_time_off_decided
        "stock_alert" -> R.string.sh_v10_notif_stock_alert
        "arrival" -> R.string.sh_v10_notif_arrival
        "lab_overdue" -> R.string.sh_v10_notif_lab_overdue
        "payment_due" -> R.string.sh_v10_notif_payment_due
        "recall_due" -> R.string.sh_v10_notif_recall_due
        "plan_response" -> R.string.sh_v10_notif_plan_response
        "booking_conflict" -> R.string.sh_v10_notif_booking_conflict
        else -> R.string.sh_v10_notif_generic
    }

private const val MAX = 30
