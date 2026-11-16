package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.analytics.AnalyticsView
import com.aarogyam.staff.android.R
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** New against returning patient visits per week or month, as two lines over soft areas. */
@Composable
internal fun PatientsTrendCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val (axis, full) = bucketNames(view)
    val fresh = stringResource(R.string.an_patients_new)
    val back = stringResource(R.string.an_patients_returning)
    val rows =
        view.points.mapIndexed {
            i,
            p,
            ->
            stringResource(R.string.an_patients_a11y, full[i], p.newPatients, p.returningPatients)
        }
    ChartCard(stringResource(R.string.an_patients_title), perBucket(view)) {
        BucketChart(
            labels = axis,
            bars = emptyList(),
            lines =
                listOf(
                    ChartSeries(fresh, colors.primary.color, view.points.map { it.newPatients.toDouble() }),
                    ChartSeries(back, colors.warning.color, view.points.map { it.returningPatients.toDouble() }),
                ),
            areas = true,
            formatY = { it.toLong().toString() },
            description = rows.joinToString(". "),
            detail = { rows[it] },
            height = 190.dp,
        )
    }
}

/** Booked against walk-in visits as one bar split in two, with the counts under it. */
@Composable
internal fun SourcesCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val split = view.visitSources
    val percent = split.bookedPercent
    ChartCard(stringResource(R.string.an_sources_title), percent?.let { stringResource(R.string.an_chairs_row, it) }) {
        if (percent == null) {
            CardNote(stringResource(R.string.an_sources_none))
        } else {
            val description = stringResource(R.string.an_sources_a11y, split.booked.toInt(), split.walkIn.toInt())
            Row(
                Modifier.fillMaxWidth().height(28.dp).semantics { contentDescription = description },
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (split.booked >
                    0
                ) {
                    Column(
                        Modifier.weight(split.booked.toFloat()).height(28.dp).background(colors.primary.color),
                    ) {}
                }
                if (split.walkIn >
                    0
                ) {
                    Column(
                        Modifier.weight(split.walkIn.toFloat()).height(28.dp).background(colors.warning.color),
                    ) {}
                }
            }
            Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                LegendDot(stringResource(R.string.an_sources_booked), colors.primary.color, split.booked.toString())
                LegendDot(stringResource(R.string.an_sources_walkin), colors.warning.color, split.walkIn.toString())
            }
        }
    }
}

/** Patients seen by sex, biggest first. */
@Composable
internal fun SexCard(view: AnalyticsView) {
    ChartCard(stringResource(R.string.an_sex_title)) {
        if (view.sex.all { it.value == 0L }) {
            CardNote(stringResource(R.string.an_sex_none))
        } else {
            ShareRows(
                view.sex.map { ShareRow(sexName(it.key), it.value, it.value.toString()) },
                SkTheme.colors.primary.color,
            )
        }
    }
}

@Composable
private fun sexName(key: String): String =
    when (key.lowercase()) {
        "female", "f" -> stringResource(R.string.an_sex_female)
        "male", "m" -> stringResource(R.string.an_sex_male)
        "other" -> stringResource(R.string.an_sex_other)
        "unknown" -> stringResource(R.string.an_sex_unknown)
        else -> AnalyticsFormat.keyText(key)
    }

/** Patient visits by age band, as share bars. */
@Composable
internal fun AgeCard(view: AnalyticsView) {
    ChartCard(stringResource(R.string.an_c_age), stringResource(R.string.an_c_age_sub)) {
        if (view.ageBands.all { it.value == 0L }) {
            CardNote(stringResource(R.string.an_c_no_data))
        } else {
            ShareRows(
                view.ageBands.map {
                    ShareRow(
                        if (it.key ==
                            "unknown"
                        ) {
                            it.key
                        } else {
                            AnalyticsFormat.ageBand(it.key)
                        },
                        it.value,
                        it.value.toString(),
                    )
                },
                SkTheme.colors.primary.color,
            )
        }
    }
}

/** How long the lab takes: the average days, and how many orders it covers. */
@Composable
internal fun LabCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val lab = view.lab
    ChartCard(stringResource(R.string.an_lab_title)) {
        val days = lab.averageDays
        val orders = stringResource(R.string.an_lab_orders, lab.orders.toInt())
        if (days != null) {
            val text = AnalyticsFormat.oneDecimal(days)
            val description = stringResource(R.string.an_lab_a11y, text, lab.orders.toInt())
            Column(Modifier.clearAndSetSemantics { contentDescription = description }) {
                Text(
                    stringResource(R.string.an_lab_average, text),
                    style = SkTypography.largeTitle,
                    color = colors.text.color,
                )
                Text(
                    stringResource(R.string.an_lab_average_caption),
                    style = SkTypography.caption,
                    color = colors.textMuted.color,
                )
                Text(orders, style = SkTypography.caption, color = colors.textMuted.color)
            }
        } else {
            val none = stringResource(R.string.an_lab_none)
            CardNote(if (lab.orders > 0) "$orders. $none" else none)
        }
    }
}
