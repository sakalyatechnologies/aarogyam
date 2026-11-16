package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.analytics.AnalyticsView
import com.aarogyam.staff.android.R
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlin.math.roundToInt

private class KpiSpec(
    val label: String,
    val value: String,
    val delta: Int?,
    val note: String,
    val goodWhenDown: Boolean = false,
)

/** The headline numbers in two columns, each with its change against the range before. */
@Composable
internal fun KpiGrid(view: AnalyticsView) {
    val versus = stringResource(R.string.an_vs, view.range.days)
    val specs = mutableListOf<KpiSpec>()
    specs +=
        KpiSpec(
            stringResource(R.string.an_kpi_visits),
            view.patientVisits.value.toString(),
            view.patientVisits.deltaPercent,
            versus,
        )
    specs +=
        KpiSpec(
            stringResource(R.string.an_kpi_new),
            view.newPatients.value.toString(),
            view.newPatients.deltaPercent,
            stringResource(R.string.an_kpi_new_note),
        )
    val revenue = view.revenue
    val expenses = view.expenses
    if (revenue != null && expenses != null) {
        specs +=
            KpiSpec(
                stringResource(R.string.an_kpi_revenue),
                AnalyticsFormat.rupees(revenue.value),
                revenue.deltaPercent,
                versus,
            )
        specs +=
            KpiSpec(
                stringResource(R.string.an_kpi_expenses),
                AnalyticsFormat.rupees(expenses.value),
                expenses.deltaPercent,
                versus,
                goodWhenDown = true,
            )
        view.netPaise?.let {
            specs +=
                KpiSpec(
                    stringResource(R.string.an_kpi_net),
                    AnalyticsFormat.rupees(it),
                    null,
                    stringResource(R.string.an_kpi_net_note),
                )
        }
        view.payments?.let {
            specs +=
                KpiSpec(
                    stringResource(R.string.an_kpi_payments),
                    it.toString(),
                    null,
                    stringResource(R.string.an_kpi_payments_note),
                )
        }
    }
    val chair = view.avgChairMinutes?.let { stringResource(R.string.an_minutes, it) } ?: "–"
    specs += KpiSpec(stringResource(R.string.an_kpi_chair), chair, null, stringResource(R.string.an_kpi_chair_note))
    val use = (view.chairUtilization * PERCENT).roundToInt()
    specs += KpiSpec(stringResource(R.string.an_kpi_util), "$use%", null, stringResource(R.string.an_kpi_util_note))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        specs.chunked(2).forEach { pair ->
            Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { KpiCard(it, Modifier.weight(1f).fillMaxHeight()) }
                if (pair.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun KpiCard(
    spec: KpiSpec,
    modifier: Modifier,
) {
    val colors = SkTheme.colors
    val delta = AnalyticsFormat.delta(spec.delta)
    val bad = AnalyticsFormat.isBad(spec.delta, spec.goodWhenDown)
    val speech =
        when {
            spec.delta == null -> ""
            spec.delta < 0 -> stringResource(R.string.an_delta_down, -spec.delta)
            else -> stringResource(R.string.an_delta_up, spec.delta)
        }
    val extra = listOf(speech, spec.note).filter { it.isNotEmpty() }.joinToString(", ")
    val description = stringResource(R.string.an_kpi_a11y, spec.label, spec.value, extra)
    Box(modifier.clearAndSetSemantics { contentDescription = description }) {
        SkCard(Modifier.fillMaxHeight(), contentPadding = 12.dp) {
            Text(spec.label, style = SkTypography.caption, color = colors.textMuted.color)
            Text(spec.value, style = SkTypography.number, color = colors.text.color, maxLines = 1)
            if (delta != null) {
                SkChip(delta, Modifier.padding(top = 4.dp), tone = if (bad) SkTone.Danger else SkTone.Success)
            }
            Text(
                spec.note,
                style = SkTypography.caption,
                color = colors.textMuted.color,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

private const val PERCENT = 100
