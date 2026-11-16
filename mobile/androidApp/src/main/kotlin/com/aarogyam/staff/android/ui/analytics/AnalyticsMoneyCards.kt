package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.analytics.AnalyticsBucketKind
import com.aarogyam.staff.analytics.AnalyticsView
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.categoryLabel
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

private const val PAISE = 100.0

@Composable
internal fun bucketNames(view: AnalyticsView): Pair<List<String>, List<String>> {
    val long = view.range.days > LONG_RANGE
    val axis = view.points.map { AnalyticsFormat.axisLabel(it.start, view.bucket, long) }
    val full = view.points.map { AnalyticsFormat.bucketLabel(it.start, view.bucket) }
    return axis to full
}

@Composable
internal fun perBucket(view: AnalyticsView): String =
    stringResource(if (view.bucket == AnalyticsBucketKind.Week) R.string.an_per_week else R.string.an_per_month)

/** Revenue and expenses side by side per week or month, with the net as a line over them. */
@Composable
internal fun MoneyChartCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val (axis, full) = bucketNames(view)
    val revenue = stringResource(R.string.an_kpi_revenue)
    val expenses = stringResource(R.string.an_kpi_expenses)
    val net = stringResource(R.string.an_kpi_net)
    val income = view.points.map { (it.incomePaise ?: 0L) / PAISE }
    val spent = view.points.map { (it.expensesPaise ?: 0L) / PAISE }
    val nets = view.points.map { (it.netPaise ?: 0L) / PAISE }
    val netTotal = AnalyticsFormat.rupees(view.netPaise ?: 0L)
    val rows =
        view.points.mapIndexed { i, p ->
            stringResource(
                R.string.an_money_a11y,
                full[i],
                AnalyticsFormat.rupees(p.incomePaise ?: 0L),
                AnalyticsFormat.rupees(p.expensesPaise ?: 0L),
                AnalyticsFormat.rupees(p.netPaise ?: 0L),
            )
        }
    val caption = rangeCaption(view)
    val description = stringResource(R.string.an_money_chart_a11y, caption, netTotal) + ". " + rows.joinToString(". ")
    ChartCard(stringResource(R.string.an_money_title), perBucket(view)) {
        BucketChart(
            labels = axis,
            bars =
                listOf(
                    ChartSeries(revenue, colors.primary.color, income),
                    ChartSeries(expenses, colors.warning.color, spent),
                ),
            lines = listOf(ChartSeries(net, colors.text.color, nets)),
            areas = false,
            formatY = { AnalyticsFormat.rupees((it * PAISE).toLong()) },
            description = description,
            detail = { rows[it] },
        )
        androidx.compose.material3.Text(
            stringResource(R.string.an_money_net_total, netTotal),
            style = com.sakalya.mobile.designcompose.SkTypography.bodyStrong,
            color = colors.text.color,
        )
    }
}

/** What was spent by category, biggest first, with the amount on each bar and the Add expense button. */
@Composable
internal fun ExpenseCategoryCard(
    view: AnalyticsView,
    onAdd: (() -> Unit)?,
) {
    val total = view.expenses?.value ?: 0L
    ChartCard(
        stringResource(R.string.an_cat_title),
        stringResource(R.string.an_cat_total, AnalyticsFormat.rupees(total)),
    ) {
        if (view.expensesByCategory.isEmpty()) {
            CardNote(stringResource(R.string.an_cat_none))
        } else {
            ShareRows(
                view.expensesByCategory.map {
                    ShareRow(
                        stringResource(categoryLabel(AnalyticsFormat.category(it.key))),
                        it.value,
                        AnalyticsFormat.rupees(it.value),
                    )
                },
                SkTheme.colors.warning.color,
            )
        }
        if (onAdd != null) {
            SkButton(
                stringResource(R.string.an_cat_add),
                onAdd,
                variant = SkButtonVariant.Secondary,
                modifier =
                    androidx.compose.ui.Modifier
                        .fillMaxWidth(),
            )
        }
    }
}

private const val LONG_RANGE = 400
