package com.aarogyam.staff.android.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.EntryStatus
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.chart.HistoryEntryView
import com.aarogyam.staff.chart.HistoryState
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.SurfaceFinding
import com.aarogyam.staff.chart.TermKind
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.chart.ToothSelection
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.chart.hasLabel
import com.aarogyam.staff.chart.matchTerms
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The picked tooth: what is on it now, a surface picker, the record action and its history. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ToothPanel(
    selection: ToothSelection,
    canRecord: Boolean,
    saving: Boolean,
    onSurface: (Surface?) -> Unit,
    onRecord: () -> Unit,
) {
    val tooth = selection.tooth
    SkCard {
        Text(
            stringResource(R.string.chart_tooth, tooth.number) + " · " + stringResource(tooth.kind.label()),
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
        )
        Caption(R.string.chart_surface)
        SurfacePicker(tooth, selection.surface, onSurface)
        Caption(R.string.chart_now)
        val findings = tooth.findings.ifEmpty { listOf(SurfaceFinding(null, Finding.Sound)) }
        findings.forEach { (surface, finding) ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            ) {
                FindingSwatch(finding)
                Text(
                    stringResource(finding.label()) + ", " + surfaceText(tooth, surface),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.text.color,
                )
            }
        }
        if (canRecord) {
            SkButton(
                stringResource(if (saving) R.string.chart_saving else R.string.chart_record),
                onRecord,
                enabled = !saving,
                modifier = Modifier.padding(top = Spacing.M.dp),
            )
        }
        Caption(R.string.chart_history)
        History(tooth, selection.history)
    }
}

/** The teeth picked with "Select several", and the action that records one finding on all of them. */
@Composable
fun GroupPanel(
    group: List<Int>,
    canRecord: Boolean,
    saving: Boolean,
    onRecord: () -> Unit,
) {
    SkCard {
        Text(
            pluralStringResource(R.plurals.chart_group_title, group.size, group.size),
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
        )
        Text(group.joinToString(", "), style = SkTypography.footnote, color = SkTheme.colors.text.color)
        Text(
            stringResource(R.string.chart_group_hint),
            style = SkTypography.footnote,
            color = SkTheme.colors.textMuted.color,
        )
        if (canRecord) {
            SkButton(
                if (saving) {
                    stringResource(R.string.chart_saving)
                } else {
                    pluralStringResource(R.plurals.chart_record_group, group.size, group.size)
                },
                onRecord,
                enabled = !saving,
                modifier = Modifier.padding(top = Spacing.M.dp),
            )
        }
    }
}

@Composable
internal fun Caption(text: Int) =
    Text(
        stringResource(text).uppercase(),
        style = SkTypography.overline,
        color = SkTheme.colors.textMuted.color,
        modifier = Modifier.padding(top = Spacing.M.dp, bottom = Spacing.XS.dp),
    )

@Composable
private fun surfaceText(
    tooth: ToothView,
    surface: Surface?,
): String =
    if (surface ==
        null
    ) {
        stringResource(R.string.chart_whole_tooth)
    } else {
        stringResource(tooth.surfaceName(surface).label())
    }

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SurfacePicker(
    tooth: ToothView,
    surface: Surface?,
    onSurface: (Surface?) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
    ) {
        Pill(stringResource(R.string.chart_whole_tooth), surface == null) { onSurface(null) }
        Surface.entries.forEach { s ->
            Pill(stringResource(tooth.surfaceName(s).label()), surface == s) { onSurface(s) }
        }
    }
}

@Composable
private fun History(
    tooth: ToothView,
    history: HistoryState,
) {
    val muted = SkTheme.colors.textMuted.color
    when (history) {
        HistoryState.Loading -> {
            Text(stringResource(R.string.loading), style = SkTypography.footnote, color = muted)
        }

        is HistoryState.Failed -> {
            Text(
                stringResource(R.string.chart_history_failed),
                style = SkTypography.footnote,
                color = SkTheme.colors.dangerText.color,
            )
        }

        is HistoryState.Loaded -> {
            if (history.entries.isEmpty()) {
                Text(
                    stringResource(R.string.chart_history_none),
                    style = SkTypography.footnote,
                    color = muted,
                )
            }
            history.entries.forEach { HistoryLine(tooth, it) }
        }
    }
}

/** One history entry, drawn as the mock-up's treatment line: a brand bar and two lines of text. */
@Composable
private fun HistoryLine(
    tooth: ToothView,
    entry: HistoryEntryView,
) {
    val colors = SkTheme.colors
    val current = entry.status == EntryStatus.Current
    val status =
        when (entry.status) {
            EntryStatus.Current -> null
            EntryStatus.Superseded -> stringResource(R.string.chart_superseded)
            EntryStatus.EnteredInError -> stringResource(R.string.chart_entered_in_error)
        }
    Row(
        Modifier
            .padding(vertical = Spacing.XS.dp)
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .background(colors.inset.color, RoundedCornerShape(topEnd = Spacing.M.dp, bottomEnd = Spacing.M.dp)),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(if (current) colors.brand.color else colors.rule.color))
        Column(Modifier.padding(horizontal = Spacing.ML.dp, vertical = Spacing.SM.dp)) {
            Text(
                stringResource(entry.finding.label()) + ", " + surfaceText(tooth, entry.surface),
                style = SkTypography.bodyStrong,
                color = if (current) colors.text.color else colors.textMuted.color,
            )
            val treatment = listOfNotNull(entry.procedure, entry.material).joinToString(" · ")
            if (treatment.isNotEmpty()) Text(treatment, style = SkTypography.footnote, color = colors.text.color)
            val details = listOfNotNull(entry.at?.date?.display(), status, entry.note).joinToString(" · ")
            if (details.isNotEmpty()) Text(details, style = SkTypography.footnote, color = colors.textMuted.color)
        }
    }
}

/** A selectable pill: brand-filled when chosen. */
@Composable
fun Pill(
    text: String,
    selected: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    val shape = RoundedCornerShape(Spacing.ML.dp)
    Box(
        Modifier
            .sizeIn(minHeight = Spacing.MIN_TOUCH_TARGET.dp)
            .background(if (selected) colors.primary.color else colors.inset.color, shape)
            .border(1.dp, if (selected) colors.primary.color else colors.rule.color, shape)
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics { this.selected = selected }
            .padding(horizontal = Spacing.ML.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = SkTypography.label,
            color =
                if (selected) {
                    colors.onPrimary.color
                } else if (enabled) {
                    colors.text.color
                } else {
                    colors.textMuted.color
                },
        )
    }
}
