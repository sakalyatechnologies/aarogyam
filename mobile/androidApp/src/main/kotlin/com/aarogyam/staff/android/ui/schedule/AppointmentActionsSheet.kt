package com.aarogyam.staff.android.ui.schedule

import android.content.Intent
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.AppointmentSummary
import com.aarogyam.staff.android.ui.PinnedSheet
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.PatientLinks
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.calendar.AppointmentActionsHolder
import com.aarogyam.staff.calendar.ApptAction
import com.aarogyam.staff.calendar.ApptActionState
import com.aarogyam.staff.calendar.CalendarEntry
import com.aarogyam.staff.calendar.CancelReason
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.todayIn
import kotlin.time.Clock

private const val MENU = 0
private const val CANCEL = 1
private const val MOVE = 2

/** The tapped appointment: its details and Confirm, Reschedule, Cancel, Mark no-show and Call. */
@Composable
fun AppointmentActionsSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    entry: CalendarEntry,
    onChanged: () -> Unit,
    onDismiss: () -> Unit,
    onOpenPatient: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember(entry.appointmentId) { graph.appointmentActions(clinic, entry, scope, onChanged) }
    val state by holder.state.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableIntStateOf(MENU) }
    LaunchedEffect(state.done) { if (state.done != null) onDismiss() }
    PinnedSheet(title = entry.patientName, subtitle = entry.patientNumber, onDismiss = onDismiss) {
        when (mode) {
            MOVE -> Reschedule(graph, clinic, entry, onChanged, onDismiss) { mode = MENU }
            CANCEL -> CancelForm(holder, state) { mode = MENU }
            else -> Menu(entry, holder, state, onOpenPatient, { mode = CANCEL }, { mode = MOVE })
        }
        state.error?.let { Text(stringResource(it.message()), style = v7(12f), color = SkTheme.palette.error.color) }
    }
    Dialer(holder, state)
    if (state.askDoubleBook) {
        AlertDialog(
            onDismissRequest = holder::dismissDoubleBook,
            title = { Text(stringResource(R.string.appt_taken_title)) },
            confirmButton = { TextButton(holder::confirmAnyway) { Text(stringResource(R.string.appt_taken_yes)) } },
            dismissButton = { TextButton(holder::dismissDoubleBook) { Text(stringResource(R.string.appt_taken_no)) } },
        )
    }
}

/** Opens the dialler once the holder has the number; a missing number shows a note. */
@Composable
private fun Dialer(
    holder: AppointmentActionsHolder,
    state: ApptActionState,
) {
    val context = LocalContext.current
    LaunchedEffect(state.dial) {
        val uri = PatientLinks.tel(state.dial) ?: return@LaunchedEffect
        runCatching {
            context.startActivity(
                Intent(Intent.ACTION_DIAL, uri.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        holder.dialed()
    }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.Menu(
    entry: CalendarEntry,
    holder: AppointmentActionsHolder,
    state: ApptActionState,
    onOpenPatient: () -> Unit,
    onCancel: () -> Unit,
    onMove: () -> Unit,
) {
    AppointmentSummary(entry)
    if (entry.online) Text(stringResource(R.string.appt_badge), style = v7(12f), color = SkTheme.palette.primary.color)
    holder.actions().forEach { action ->
        when (action) {
            ApptAction.Confirm -> {
                SkPillButton(
                    stringResource(R.string.appt_confirm),
                    holder::confirm,
                    variant = SkPillVariant.Warm,
                    wide = true,
                    loading = state.busy,
                )
            }

            ApptAction.Reschedule -> {
                SkPillButton(
                    stringResource(R.string.appt_reschedule),
                    onMove,
                    variant = SkPillVariant.Tonal,
                    wide = true,
                )
            }

            ApptAction.Cancel -> {
                SkPillButton(
                    stringResource(R.string.appt_cancel),
                    onCancel,
                    variant = SkPillVariant.Ghost,
                    wide = true,
                )
            }

            ApptAction.NoShow -> {
                SkPillButton(
                    stringResource(R.string.appt_no_show),
                    holder::noShow,
                    variant = SkPillVariant.Ghost,
                    wide = true,
                    loading = state.busy,
                )
            }

            ApptAction.Call -> {
                SkPillButton(
                    stringResource(R.string.appt_call),
                    holder::call,
                    variant = SkPillVariant.Tonal,
                    wide = true,
                    loading = state.busy,
                )
            }
        }
    }
    if (state.noPhone) {
        Text(
            stringResource(R.string.appt_no_phone),
            style = v7(12f),
            color = SkTheme.palette.onSurfaceVariant.color,
        )
    }
    SkPillButton(stringResource(R.string.open_patient), onOpenPatient, variant = SkPillVariant.Ghost, wide = true)
}

@Composable
private fun CancelForm(
    holder: AppointmentActionsHolder,
    state: ApptActionState,
    onBack: () -> Unit,
) {
    var reason by rememberSaveable { mutableStateOf("") }
    val labels =
        mapOf(
            CancelReason.PatientAsked to stringResource(R.string.appt_cancel_patient),
            CancelReason.DoctorUnavailable to stringResource(R.string.appt_cancel_doctor),
            CancelReason.Duplicate to stringResource(R.string.appt_cancel_duplicate),
        )
    Text(stringResource(R.string.appt_cancel_title), style = v7(16f), color = SkTheme.palette.onSurface.color)
    SkChoiceChips(
        CancelReason.entries,
        setOfNotNull(CancelReason.entries.firstOrNull { it.text == reason }),
        { reason = it.text },
        { labels.getValue(it) },
    )
    SkField(stringResource(R.string.appt_cancel_reason), reason, { reason = it })
    SkPillButton(
        stringResource(R.string.appt_cancel_submit),
        { holder.cancel(reason) },
        variant = SkPillVariant.Warm,
        wide = true,
        loading = state.busy,
        enabled = reason.isNotBlank(),
    )
    SkPillButton(stringResource(R.string.appt_back), onBack, variant = SkPillVariant.Ghost, wide = true)
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.Reschedule(
    graph: AppGraph,
    clinic: ClinicContext,
    entry: CalendarEntry,
    onChanged: () -> Unit,
    onDismiss: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val today = remember { Clock.System.todayIn(clinic.timeZone) }
    val holder = remember { graph.reschedule(clinic, entry, today, scope, onChanged) }
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.moved) { if (state.moved) onDismiss() }
    RescheduleBody(holder, state, today, onBack)
}
