package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.analytics.AnalyticsView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** All the cards of one range, top to bottom: numbers, money, patients, chairs, then the mix (as iOS `AnalyticsCards`). */
@Composable
fun AnalyticsCards(
    view: AnalyticsView,
    onAddExpense: (() -> Unit)?,
) {
    KpiGrid(view)
    if (view.revenue != null) {
        MoneyChartCard(view)
        ExpenseCategoryCard(view, onAddExpense)
    }
    PatientsTrendCard(view)
    ChairsCard(view)
    ChairTimeCard(view)
    HeatCard(view)
    SourcesCard(view)
    ProceduresCard(view)
    MixCard(view)
    AgeCard(view)
    SexCard(view)
    LabCard(view)
}

/** A rounded card with a heading and a quiet sub-line. */
@Composable
internal fun ChartCard(
    title: String,
    sub: String? = null,
    content: @Composable () -> Unit,
) {
    val colors = SkTheme.colors
    SkCard(contentPadding = 14.dp) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                title,
                style = SkTypography.headline,
                color = colors.text.color,
                modifier = Modifier.weight(1f, fill = false).semantics { heading() },
            )
            if (sub != null) Text(sub, style = SkTypography.caption, color = colors.textMuted.color)
        }
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
            Box(Modifier.height(Spacing.XS.dp))
            content()
        }
    }
}

/** One quiet line inside a card, for a range that has none of that data. */
@Composable
internal fun CardNote(text: String) {
    Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)
}

/** A coloured dot and a name, for chart keys (hidden from TalkBack: the chart carries the numbers). */
@Composable
internal fun LegendDot(
    name: String,
    color: Color,
    figure: String? = null,
) {
    val colors = SkTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Text(name, style = SkTypography.caption, color = colors.text.color)
        if (figure != null) Text(figure, style = SkTypography.bodyStrong, color = colors.text.color)
    }
}

/** One labelled bar of [ShareRows]. */
internal class ShareRow(
    val label: String,
    val value: Long,
    val text: String,
    val description: String = "$label, $text",
)

/** Rows of a label, a figure and a bar sized against the biggest. */
@Composable
internal fun ShareRows(
    rows: List<ShareRow>,
    tint: Color,
) {
    val colors = SkTheme.colors
    val shares = AnalyticsFormat.shares(rows.map { it.value })
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEachIndexed { index, row ->
            Column(
                Modifier.semantics(mergeDescendants = true) { contentDescription = row.description },
                verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        row.label,
                        style = SkTypography.footnote,
                        color = colors.text.color,
                        maxLines = 2,
                        modifier = Modifier.weight(1f),
                    )
                    Text(row.text, style = SkTypography.bodyStrong, color = colors.text.color)
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(colors.inset.color),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(shares[index].coerceAtLeast(MIN_BAR))
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(tint),
                    )
                }
            }
        }
    }
}

private const val MIN_BAR = 0.03f
