package com.aarogyam.staff.android.ui.timeoff

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.timeoff.TimeOffHolder
import com.aarogyam.staff.timeoff.TimeOffRow
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.todayIn
import java.util.Locale
import kotlin.time.Clock

private const val CARD_RADIUS = 18

/**
 * Time off (iOS `TimeOffScreen`): the person's own requests with their status, a Request time off sheet,
 * and for `time_off.manage` the others' pending requests with Approve and Decline.
 */
@Composable
fun TimeOffPage(
    holder: TimeOffHolder,
    clinic: ClinicContext,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    var asking by rememberSaveable { mutableStateOf(false) }
    val locale = LocalConfiguration.current.locales[0]
    LaunchedEffect(holder) { holder.refresh() }
    Column(Modifier.fillMaxSize()) {
        SkCollapsingTopBar(
            stringResource(R.string.timeoff_title),
            collapsed = false,
            navigation = { BarAction(stringResource(R.string.back), p.primary.color, onBack) },
        )
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            val canAsk = "time_off.request" in clinic.permissions
            val loadError = state.loadError
            when {
                !canAsk && !state.canManage -> {
                    Text(
                        stringResource(R.string.timeoff_not_allowed),
                        style = SkTypography.bodyText,
                        color = p.onSurfaceVariant.color,
                    )
                }

                state.loading -> {
                    SkLoadingIndicator(stringResource(R.string.timeoff_loading), Modifier.fillMaxWidth())
                }

                loadError != null -> {
                    Text(stringResource(loadError.message()), style = SkTypography.footnote, color = p.error.color)
                    SkPillButton(stringResource(R.string.timeoff_retry), holder::refresh, variant = SkPillVariant.Tonal)
                }

                else -> {
                    if (canAsk) SkPillButton(stringResource(R.string.timeoff_request), { asking = true }, wide = true)
                    if (state.pending.isNotEmpty()) {
                        Section(stringResource(R.string.timeoff_pending))
                        state.pending.forEach { row ->
                            RequestCard(
                                row,
                                locale,
                                onApprove = { holder.approve(row.id, null) },
                                onDecline = { holder.decline(row.id, null) },
                            )
                        }
                    }
                    Section(stringResource(R.string.timeoff_mine))
                    if (state.mine.isEmpty()) SkEmptyState(stringResource(R.string.timeoff_empty), "")
                    state.mine.forEach { row -> RequestCard(row, locale, onWithdraw = { holder.cancel(row.id) }) }
                }
            }
            Spacer(Modifier.height(96.dp))
        }
    }
    if (asking) {
        TimeOffRequestSheet(holder, Clock.System.todayIn(clinic.timeZone).toString()) { asking = false }
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = SkTypography.bodyStrong, color = SkTheme.palette.onSurface.color)
}

@Composable
private fun RequestCard(
    row: TimeOffRow,
    locale: Locale,
    onWithdraw: (() -> Unit)? = null,
    onApprove: (() -> Unit)? = null,
    onDecline: (() -> Unit)? = null,
) {
    val p = SkTheme.palette
    val first = TimeOffFormat.day(row.firstDay, locale)
    val days =
        if (row.firstDay ==
            row.lastDay
        ) {
            first
        } else {
            stringResource(R.string.timeoff_range, first, TimeOffFormat.day(row.lastDay, locale))
        }
    Column(
        Modifier.fillMaxWidth().background(p.surface2.color, RoundedCornerShape(CARD_RADIUS.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(row.memberName ?: days, style = SkTypography.bodyStrong, color = p.onSurface.color)
                if (row.memberName != null) Text(days, style = SkTypography.caption, color = p.onSurfaceVariant.color)
            }
            SkChip(stringResource(TimeOffFormat.statusLabel(row.status)), tone = TimeOffFormat.statusTone(row.status))
        }
        Text(
            stringResource(TimeOffFormat.kindLabel(row.kind)),
            style = SkTypography.footnote,
            color = p.onSurfaceVariant.color,
        )
        row.reason?.let { Text(it, style = SkTypography.footnote, color = p.onSurface.color) }
        row.decisionNote?.let {
            Text(
                stringResource(R.string.timeoff_decision_note, it),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
        }
        row.error?.let {
            Text(stringResource(R.string.timeoff_action_failed), style = SkTypography.caption, color = p.error.color)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (onApprove !=
                null
            ) {
                SkPillButton(
                    stringResource(R.string.timeoff_approve),
                    onApprove,
                    enabled = !row.busy,
                    loading = row.busy,
                )
            }
            if (onDecline !=
                null
            ) {
                SkPillButton(
                    stringResource(R.string.timeoff_decline),
                    onDecline,
                    variant = SkPillVariant.Tonal,
                    enabled = !row.busy,
                )
            }
            if (onWithdraw != null && row.canCancel) {
                SkPillButton(
                    stringResource(R.string.timeoff_withdraw),
                    onWithdraw,
                    variant = SkPillVariant.Tonal,
                    enabled = !row.busy,
                    loading = row.busy,
                )
            }
        }
    }
}
