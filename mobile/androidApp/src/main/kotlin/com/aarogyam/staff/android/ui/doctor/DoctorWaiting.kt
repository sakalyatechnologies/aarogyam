package com.aarogyam.staff.android.ui.doctor

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.WaitingPatient
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.doctorWaiting
import com.aarogyam.staff.nav.Home
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Whether the "Waiting for you" card belongs on Today: the person's home is the doctor's. */
fun showsWaiting(permissions: Set<String>): Boolean =
    com.aarogyam.staff.nav
        .homeChoiceOf(permissions)
        .home == Home.Doctor

/**
 * The doctor's "Waiting for you" card, inline at the top of Today (iOS `DoctorWaitingHook`). Draws nothing until the
 * person's practitioner id is known. [onStart] gets the queue token id to open the visit from.
 */
@Composable
fun DoctorWaitingTop(
    graph: AppGraph,
    clinic: ClinicContext,
    onStart: (String) -> Unit,
) {
    val choice by rememberHolder { graph.homeChoice(clinic, it) }.choice.collectAsStateWithLifecycle()
    val practitioner = choice.practitionerId
    if (choice.home == Home.Doctor && practitioner != null) {
        WaitingHost(graph, clinic, practitioner, onStart)
    }
}

@Composable
private fun WaitingHost(
    graph: AppGraph,
    clinic: ClinicContext,
    practitionerId: String,
    onStart: (String) -> Unit,
) {
    val holder = rememberHolder { graph.doctorWaiting(clinic, practitionerId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    var collapsed by remember { mutableStateOf(false) }
    var known by remember { mutableStateOf<Set<String>?>(null) }
    val haptic = LocalHapticFeedback.current
    val ids = state.rows.map { it.id }
    // The first list only sets what is known; a token that was not there before is an arrival.
    LaunchedEffect(ids, state.loaded) {
        if (!state.loaded) return@LaunchedEffect
        val before = known
        known = ids.toSet()
        if (before != null && ids.any { it !in before }) {
            collapsed = false
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        }
    }
    // Leaving for the visit, then coming back, should show the queue as it is now.
    LaunchedEffect(holder) { holder.refresh() }
    val p = SkTheme.palette
    val title = stringResource(R.string.sh_dv10_waiting_title)
    when {
        collapsed -> {
            Text(
                title,
                style = SkTypography.bodyStrong,
                color = p.onSurface.color,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                        .clickable(role = Role.Button) { collapsed = false }
                        .padding(horizontal = Spacing.L.dp, vertical = Spacing.S.dp),
            )
        }

        state.loaded && state.rows.isEmpty() && !state.failed -> {
            // Nobody waiting: one quiet line, so Today keeps the screen.
            Row(
                Modifier.fillMaxWidth().heightIn(min = Spacing.MIN_TOUCH_TARGET.dp).padding(horizontal = Spacing.L.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(title, style = SkTypography.bodyStrong, color = p.onSurface.color)
                Text(
                    stringResource(R.string.sh_dv10_waiting_empty),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                )
            }
        }

        else -> {
            Column(
                Modifier
                    .heightIn(max = CARD_MAX.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.L.dp),
                verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        title,
                        style = SkTypography.titleSmall,
                        color = p.onSurface.color,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        stringResource(R.string.sh_dv10_close),
                        style = SkTypography.label,
                        color = p.primary.color,
                        modifier =
                            Modifier
                                .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                                .clickable(role = Role.Button) { collapsed = true }
                                .padding(horizontal = Spacing.S.dp),
                    )
                }
                if (state.failed) {
                    Text(
                        stringResource(R.string.sh_dv10_waiting_offline),
                        style = SkTypography.footnote,
                        color = p.error.color,
                    )
                }
                if (state.rows.isEmpty()) {
                    Text(
                        stringResource(R.string.sh_dv10_waiting_empty),
                        style = SkTypography.footnote,
                        color = p.onSurfaceVariant.color,
                    )
                }
                state.rows.forEach { row -> WaitingRow(row, onSendIn = { holder.sendIn(row.id) }, onStart = onStart) }
            }
        }
    }
}

@Composable
private fun WaitingRow(
    row: WaitingPatient,
    onSendIn: () -> Unit,
    onStart: (String) -> Unit,
) {
    val p = SkTheme.palette
    val token = row.tokenNumber.toString()
    val who = ageSex(row.ageYears, row.sex)
    val label =
        stringResource(
            R.string.sh_dv10_waiting_row_a11y,
            token,
            who,
            row.waitMinutes.toString(),
            row.reason.orEmpty(),
        )
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.surface2.color, RoundedCornerShape(ROW_RADIUS.dp))
            .padding(Spacing.M.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
    ) {
        Column(
            Modifier.weight(1f).semantics { contentDescription = label },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                stringResource(R.string.sh_dv10_token, token),
                style = SkTypography.titleSmall.copy(fontWeight = FontWeight.ExtraBold),
                color = p.onSurface.color,
            )
            if (who.isNotEmpty()) Text(who, style = SkTypography.footnote, color = p.onSurfaceVariant.color)
            row.reason?.let { Text(it, style = SkTypography.footnote, color = p.onSurface.color, maxLines = 2) }
            Text(
                if (row.called) {
                    stringResource(R.string.sh_dv10_called)
                } else {
                    stringResource(R.string.sh_dv10_wait, row.waitMinutes.toString())
                },
                style = SkTypography.caption,
                color = if (row.called) p.primary.color else p.onSurfaceVariant.color,
            )
        }
        if (row.called) {
            SkPillButton(stringResource(R.string.sh_dv10_start), { onStart(row.id) })
        } else {
            SkPillButton(stringResource(R.string.sh_dv10_sendin), onSendIn, enabled = !row.busy)
        }
    }
}

private const val CARD_MAX = 300
private const val ROW_RADIUS = 16
