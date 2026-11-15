package com.aarogyam.staff.android.ui.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.tasks.MyTasksHolder
import com.aarogyam.staff.tasks.TaskAction
import com.aarogyam.staff.tasks.TaskRow
import com.aarogyam.staff.tasks.UsageLine
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.StockRow
import com.sakalya.mobile.design.ReducedMotion
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.Instant
import java.time.ZoneId

private const val NOTE_MAX = 300

/** My tasks (iOS `TasksV10Screen`): the open tasks with a Done button each, a photo-proof button, and confetti when one finishes. */
@Composable
fun TasksSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: MyTasksHolder,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    var noteFor by remember { mutableStateOf<TaskRow?>(null) }
    var usageFor by remember { mutableStateOf<TaskRow?>(null) }
    var bursts by remember { mutableIntStateOf(0) }
    // The photo picked for a row, kept until the row leaves so a retry sends it too.
    val proofs: SnapshotStateMap<String, ByteArray> = remember { mutableStateMapOf() }
    val haptic = LocalHapticFeedback.current
    LaunchedEffect(holder) { holder.refresh() }
    LaunchedEffect(holder) {
        holder.celebrate.collect {
            bursts++
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        }
    }
    LaunchedEffect(state.rows) {
        val ids = state.rows.map { it.id }.toSet()
        proofs.keys.filterNot { it in ids }.forEach { proofs.remove(it) }
    }
    val finish = { row: TaskRow, note: String?, usage: List<UsageLine>? ->
        val photo = proofs[row.id]
        if (photo !=
            null
        ) {
            holder.completeWithProof(row.id, note, usage, photo)
        } else {
            holder.complete(row.id, note, usage)
        }
    }
    val start = { row: TaskRow, withProof: Boolean ->
        when {
            row.action == TaskAction.None && (row.error != null || withProof) -> finish(row, null, null)
            row.action == TaskAction.RecordUsage -> usageFor = row
            row.action == TaskAction.ConfirmPhotos -> finish(row, null, null)
            else -> noteFor = row
        }
    }
    SkModalSheet(stringResource(R.string.sh_tasks10_title), onDismiss) {
        Box {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (!state.notAllowed && !state.loading) {
                    Text(
                        stringResource(R.string.sh_tasks10_open_count, state.openCount),
                        style = SkTypography.footnote,
                        color = p.onSurfaceVariant.color,
                    )
                }
                when {
                    state.notAllowed -> {
                        Text(
                            stringResource(R.string.sh_tasks10_not_allowed),
                            style = SkTypography.bodyText,
                            color = p.onSurfaceVariant.color,
                        )
                    }

                    state.loading -> {
                        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            SkLoadingIndicator(stringResource(R.string.sh_tasks10_loading))
                        }
                    }

                    state.rows.isEmpty() -> {
                        val error = state.loadError
                        if (error != null) {
                            Text(stringResource(error.message()), style = SkTypography.footnote, color = p.error.color)
                            SkPillButton(
                                stringResource(R.string.sh_tasks10_retry),
                                holder::refresh,
                                variant = SkPillVariant.Tonal,
                            )
                        } else {
                            SkEmptyState(stringResource(R.string.sh_tasks10_empty), "")
                        }
                    }

                    else -> {
                        state.rows.forEach { row ->
                            TaskRowCard(
                                row,
                                onDone = { start(row, false) },
                                onProof = {
                                    proofs[row.id] = it
                                    start(row, true)
                                },
                            )
                        }
                    }
                }
            }
            if (bursts > 0 && SkTheme.reducedMotion == ReducedMotion.Off) Confetti(bursts)
        }
    }
    noteFor?.let { row ->
        NoteSheet(row, onDismiss = { noteFor = null }) { note ->
            noteFor = null
            finish(row, note, null)
        }
    }
    usageFor?.let { row ->
        UsageSheet(graph, clinic, row, onDismiss = { usageFor = null }) { note, lines ->
            usageFor = null
            finish(row, note, lines)
        }
    }
}

@Composable
private fun TaskRowCard(
    row: TaskRow,
    onDone: () -> Unit,
    onProof: (ByteArray) -> Unit,
) {
    val p = SkTheme.palette
    val locale = LocalConfiguration.current.locales[0]
    val due = TasksFormat.dueText(row.dueAt, ZoneId.systemDefault(), Instant.now(), locale)
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.surface2.color, RoundedCornerShape(CARD_RADIUS.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Text(row.title, style = SkTypography.bodyStrong, color = p.onSurface.color, modifier = Modifier.weight(1f))
            if (row.overdue) SkChip(stringResource(R.string.sh_tasks10_overdue), tone = SkTone.Danger)
        }
        due?.let {
            Text(
                stringResource(R.string.sh_tasks10_due, it),
                style = SkTypography.caption,
                color = if (row.overdue) p.error.color else p.onSurfaceVariant.color,
            )
        }
        val photos = row.patientsWithoutPhotos
        if (row.action == TaskAction.ConfirmPhotos && photos != null) {
            Text(
                stringResource(R.string.sh_tasks10_photos, photos),
                style = SkTypography.caption,
                color = p.onSurface.color,
            )
        }
        if (row.pending) {
            SkLoadingIndicator(stringResource(R.string.sh_tasks10_in_progress), size = 24.dp)
        } else {
            if (row.error != null) {
                Text(stringResource(R.string.sh_tasks10_error), style = SkTypography.caption, color = p.error.color)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                SkPillButton(
                    stringResource(if (row.error != null) R.string.sh_tasks10_retry else R.string.sh_tasks10_done),
                    onDone,
                    Modifier.weight(1f),
                    wide = true,
                )
                TaskProofButton(onProof)
            }
        }
    }
}

@Composable
private fun NoteSheet(
    row: TaskRow,
    onDismiss: () -> Unit,
    onDone: (String?) -> Unit,
) {
    var note by remember { mutableStateOf("") }
    SkModalSheet(row.title, onDismiss) {
        SkField(stringResource(R.string.sh_tasks10_note), note, { note = it.take(NOTE_MAX) }, Modifier.fillMaxWidth())
        SkPillButton(stringResource(R.string.sh_tasks10_done), { onDone(note.ifBlank { null }) }, wide = true)
    }
}

@Composable
private fun UsageSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    row: TaskRow,
    onDismiss: () -> Unit,
    onDone: (String?, List<UsageLine>) -> Unit,
) {
    val stock = rememberHolder { graph.stock(clinic, it) }
    val list by stock.state.collectAsStateWithLifecycle()
    val items = (list as? ListState.Loaded<StockRow>)?.items.orEmpty()
    var note by remember { mutableStateOf("") }
    val quantities = remember { mutableStateMapOf<String, String>() }
    val lines =
        items.mapNotNull { item ->
            TasksFormat.quantity(quantities[item.id].orEmpty())?.let { UsageLine(item.id, it) }
        }
    SkModalSheet(stringResource(R.string.sh_tasks10_usage_title), onDismiss, subtitle = row.title) {
        items.forEach { item ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            ) {
                Text("${item.name} (${item.unit})", style = SkTypography.bodyText, modifier = Modifier.weight(1f))
                SkField(
                    stringResource(R.string.sh_tasks10_usage_qty),
                    quantities[item.id].orEmpty(),
                    { quantities[item.id] = it.filter(Char::isDigit).take(QTY_DIGITS) },
                    Modifier.weight(1f),
                    keyboard =
                        androidx.compose.foundation.text.KeyboardOptions(
                            keyboardType = androidx.compose.ui.text.input.KeyboardType.Number,
                        ),
                )
            }
        }
        SkField(stringResource(R.string.sh_tasks10_note), note, { note = it.take(NOTE_MAX) }, Modifier.fillMaxWidth())
        if (lines.isNotEmpty()) {
            SkPillButton(
                stringResource(R.string.sh_tasks10_usage_save),
                { onDone(note.ifBlank { null }, lines) },
                wide = true,
            )
        }
        SkPillButton(
            stringResource(R.string.sh_tasks10_nothing_used),
            { onDone(note.ifBlank { null }, emptyList()) },
            variant = SkPillVariant.Tonal,
            wide = true,
        )
    }
}

private const val CARD_RADIUS = 16
private const val QTY_DIGITS = 6
