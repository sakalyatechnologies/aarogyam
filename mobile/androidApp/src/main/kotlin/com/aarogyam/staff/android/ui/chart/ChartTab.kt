package com.aarogyam.staff.android.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.Dentition
import com.aarogyam.staff.chart.Finding
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTabs
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The Chart tab: the tooth chart with its adult/child toggle and legend, and the picked tooth. */
@Composable
fun ChartTab(holder: ChartStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    when (val current = state) {
        ChartState.Loading -> {
            LoadingIndicator()
        }

        ChartState.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.chart_not_allowed_title),
                stringResource(R.string.chart_not_allowed_message),
            )
        }

        is ChartState.Failed -> {
            SkEmptyState(
                stringResource(R.string.chart_title),
                stringResource(current.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = holder::refresh,
            )
        }

        is ChartState.Loaded -> {
            LoadedChart(current, holder)
        }
    }
}

@Composable
private fun LoadedChart(
    state: ChartState.Loaded,
    holder: ChartStateHolder,
) {
    val zoom = remember { ChartZoom() }
    var recording by rememberSaveable { mutableStateOf(false) }
    val muted = SkTheme.colors.textMuted.color
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState(), enabled = !zoom.zoomed).padding(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        state.error?.let {
            Text(stringResource(it.message()), style = SkTypography.footnote, color = SkTheme.colors.dangerText.color)
        }
        state.recordError?.let { error ->
            SkCard {
                Text(
                    stringResource(R.string.chart_record_failed, stringResource(error.message())),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
                SkButton(
                    stringResource(R.string.chart_dismiss),
                    holder::dismissRecordError,
                    variant = SkButtonVariant.Secondary,
                )
            }
        }
        SkCard {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.chart_title),
                    style = SkTypography.headline,
                    color = SkTheme.colors.text.color,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    stringResource(R.string.chart_need_care, state.needsCare, state.total),
                    style = SkTypography.caption,
                    color = muted,
                )
            }
            SkTabs(
                titles = listOf(stringResource(R.string.chart_adult), stringResource(R.string.chart_child)),
                selectedIndex = state.dentition.ordinal,
                onSelect = {
                    zoom.reset()
                    holder.showDentition(Dentition.entries[it])
                },
            )
            Pill(stringResource(R.string.chart_several), state.several) { holder.setSeveral(!state.several) }
            ToothChart(
                upper = state.upper,
                lower = state.lower,
                group = state.group,
                selected = state.selected?.tooth?.number,
                selectedSurface = state.selected?.surface,
                zoom = zoom,
                onSelect = holder::select,
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.chart_zoom_hint),
                    style = SkTypography.caption,
                    color = muted,
                    modifier = Modifier.weight(1f),
                )
                if (zoom.scale >
                    1f
                ) {
                    SkButton(
                        stringResource(R.string.chart_reset_zoom),
                        zoom::reset,
                        variant = SkButtonVariant.Secondary,
                    )
                }
            }
        }
        val selected = state.selected
        if (state.several && state.group.size > 1) {
            GroupPanel(state.group, state.canRecord, state.saving) { recording = true }
        } else if (selected == null) {
            Text(stringResource(R.string.chart_pick_tooth), style = SkTypography.footnote, color = muted)
        } else {
            ToothPanel(
                selection = selected,
                canRecord = state.canRecord,
                saving = state.saving,
                onSurface = holder::selectSurface,
                onRecord = { recording = true },
            )
        }
        Legend()
    }
    val selected = state.selected
    if (recording && selected != null && state.canRecord) {
        val numbers = if (state.several && state.group.isNotEmpty()) state.group else listOf(selected.tooth.number)
        val all = state.upper + state.lower
        RecordFindingSheet(
            teeth = numbers.mapNotNull { n -> all.firstOrNull { it.number == n } },
            initialSurface = selected.surface.takeIf { numbers.size == 1 },
            choices =
                TermChoices(
                    terms = state.terms,
                    adding = state.addingTerm,
                    added = state.addedTerm,
                    error = state.termError,
                    onAdd = holder::addTerm,
                    onConsumed = holder::consumeAddedTerm,
                ),
            onSave = { recorded ->
                holder.record(recorded.finding, recorded.surfaces, recorded.procedure, recorded.material, recorded.note)
                recording = false
            },
            onDismiss = { recording = false },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend() {
    SkCard {
        Text(stringResource(R.string.chart_legend), style = SkTypography.headline, color = SkTheme.colors.text.color)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
            modifier = Modifier.padding(top = Spacing.SM.dp),
        ) {
            Finding.entries.forEach { finding ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
                ) {
                    FindingSwatch(finding)
                    Text(
                        stringResource(finding.label()),
                        style = SkTypography.footnote,
                        color = SkTheme.colors.text.color,
                    )
                }
            }
        }
    }
}

/** A small square drawn the way the chart draws [finding]. */
@Composable
fun FindingSwatch(finding: Finding) {
    val paint = finding.paint()
    val outline = if (finding == Finding.Crown) paint.ink else SkTheme.colors.rule.color
    Canvas(Modifier.size(SWATCH.dp)) {
        val box = Rect(0f, 0f, size.width, size.height)
        drawSwatch(paint, box, outline, dashed = finding == Finding.Missing)
    }
}

private const val SWATCH = 14
