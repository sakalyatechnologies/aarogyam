package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.desk.DeskAlert
import com.aarogyam.staff.android.ui.glass.GroupRow
import com.aarogyam.staff.android.ui.glass.KindTile
import com.aarogyam.staff.android.ui.tasks.TasksFormat
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.team.AlertRow
import com.sakalya.mobile.designcompose.SkBadgeDot
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.Instant
import java.time.ZoneId

/**
 * One bell row: an unread dot, the kind's tinted tile, the localized title (bold while unread) with the token line,
 * and the time on the right, with a chevron when the row opens a patient. Unread is said, not only drawn.
 */
@Composable
internal fun BellRow(
    row: AlertRow,
    index: Int,
    count: Int,
    modifier: Modifier,
    onOpenPatient: (String) -> Unit,
) {
    val p = SkTheme.palette
    val detail = DeskAlert.detail(row.tokenNumber, row.patientNumber, row.doctor)
    val patient = row.patientId
    val unread = stringResource(R.string.v7_notif_filter_unread)
    val locale = LocalConfiguration.current.locales[0]
    val time = TasksFormat.whenText(row.at, ZoneId.systemDefault(), Instant.now(), locale)
    GroupRow(
        index,
        count,
        modifier.semantics(mergeDescendants = true) { if (!row.read) stateDescription = unread },
        onClick = patient?.let { { onOpenPatient(it) } },
    ) {
        if (row.read) Box(Modifier.size(DOT.dp)) else SkBadgeDot()
        KindTile(TasksFormat.iconFor(row.kind), TasksFormat.tintFor(row.kind))
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(kindLabel(row.kind)),
                style = SkTypography.bodyText.copy(fontWeight = if (row.read) FontWeight.Medium else FontWeight.Bold),
                color = p.onSurface.color,
            )
            detail?.let { Text(it, style = SkTypography.caption, color = p.onSurfaceVariant.color) }
        }
        time?.let { Text(it, style = SkTypography.caption, color = p.onSurfaceVariant.color, maxLines = 1) }
        if (patient != null) SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = 16.dp)
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
        "payment_collected" -> R.string.sh_v10_notif_payment_collected
        "recall_due" -> R.string.sh_v10_notif_recall_due
        "plan_response" -> R.string.sh_v10_notif_plan_response
        "booking_conflict" -> R.string.sh_v10_notif_booking_conflict
        else -> R.string.sh_v10_notif_generic
    }

private const val DOT = 8
