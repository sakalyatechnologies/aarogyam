package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.analytics.AnalyticsBucketKind
import com.aarogyam.staff.analytics.AnalyticsPreset
import com.aarogyam.staff.analytics.AnalyticsRange
import com.aarogyam.staff.analytics.AnalyticsStateHolder
import com.aarogyam.staff.analytics.AnalyticsView
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ChoiceChips
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate

@Composable
private fun presetName(preset: AnalyticsPreset): String =
    stringResource(
        when (preset) {
            AnalyticsPreset.Week -> R.string.an_preset_week
            AnalyticsPreset.Month -> R.string.an_preset_month
            AnalyticsPreset.Year -> R.string.an_preset_year
            AnalyticsPreset.Custom -> R.string.an_preset_custom
        },
    )

/** `17 Aug – 15 Nov 2026 · by week` (or by day, by month). */
@Composable
internal fun rangeCaption(range: AnalyticsRange): String {
    val (from, to) = AnalyticsFormat.rangeEnds(range.from, range.to)
    return stringResource(
        when (range.bucket) {
            AnalyticsBucketKind.Day -> R.string.an_range_caption_day
            AnalyticsBucketKind.Week -> R.string.an_range_caption_week
            AnalyticsBucketKind.Month -> R.string.an_range_caption_month
        },
        "$from – $to",
    )
}

@Composable
internal fun rangeCaption(view: AnalyticsView): String = rangeCaption(view.range)

/** The preset chips, and for Custom the From and To pickers (at most [AnalyticsStateHolder.maxDays] apart). */
@Composable
fun RangeControls(
    holder: AnalyticsStateHolder,
    range: AnalyticsRange,
) {
    val colors = SkTheme.colors
    var picking by remember { mutableStateOf<Boolean?>(null) }
    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ChoiceChips(
            options = AnalyticsPreset.entries,
            selected = { it == range.preset },
            label = { presetName(it) },
            onPick = { if (it == AnalyticsPreset.Custom) holder.showCustom(range.from, range.to) else holder.show(it) },
        )
        if (range.preset == AnalyticsPreset.Custom) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DateField(stringResource(R.string.an_range_from), range.from, Modifier.weight(1f)) { picking = true }
                DateField(stringResource(R.string.an_range_to), range.to, Modifier.weight(1f)) { picking = false }
            }
            Text(stringResource(R.string.an_range_limit), style = SkTypography.caption, color = colors.textMuted.color)
        }
        val (from, to) = AnalyticsFormat.rangeEnds(range.from, range.to)
        val speech = stringResource(R.string.an_range_a11y, from, to)
        Text(
            rangeCaption(range),
            style = SkTypography.label,
            color = colors.textMuted.color,
            modifier = Modifier.semantics { contentDescription = speech },
        )
    }
    when (picking) {
        true -> {
            val low = AnalyticsFormat.day(AnalyticsFormat.millis(range.to) - (holder.maxDays - 1L) * DAY)
            PickDialog(range.from, low, range.to, { picking = null }) { holder.showCustom(it, range.to) }
        }

        false -> {
            PickDialog(range.to, range.from, holder.latestDay, { picking = null }) { holder.showCustom(range.from, it) }
        }

        null -> {}
    }
}

private const val DAY = 86_400_000L

@Composable
private fun DateField(
    title: String,
    day: LocalDate,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    val text = AnalyticsFormat.rangeEnds(day, day).second
    Column(
        modifier
            .heightIn(min = 48.dp)
            .background(colors.inset.color, RoundedCornerShape(14.dp))
            .semantics { contentDescription = "$title, $text" }
            .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(title, style = SkTypography.caption, color = colors.textMuted.color)
        Text(text, style = SkTypography.bodyStrong, color = colors.text.color)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PickDialog(
    initial: LocalDate,
    lower: LocalDate,
    upper: LocalDate,
    onDismiss: () -> Unit,
    onPick: (LocalDate) -> Unit,
) {
    val low = AnalyticsFormat.millis(lower)
    val high = AnalyticsFormat.millis(upper)
    val bounds =
        remember(low, high) {
            object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis in low..high

                override fun isSelectableYear(year: Int) = year in lower.year..upper.year
            }
        }
    val state =
        rememberDatePickerState(
            initialSelectedDateMillis = AnalyticsFormat.millis(initial),
            yearRange = lower.year..upper.year,
            selectableDates = bounds,
        )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(AnalyticsFormat.day(it)) }
                onDismiss()
            }) { Text(stringResource(R.string.done)) }
        },
    ) { DatePicker(state) }
}
