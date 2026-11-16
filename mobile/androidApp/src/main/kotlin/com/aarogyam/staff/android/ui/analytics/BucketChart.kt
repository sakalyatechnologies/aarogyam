package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlin.math.ceil

/** One named series of a [BucketChart]: a value per bucket. */
internal class ChartSeries(
    val name: String,
    val color: Color,
    val values: List<Double>,
)

private val AxisWidth = 46.dp
private const val LABEL_SLOTS = 5f

/**
 * Grouped bars and/or lines per week or month bucket, drawn on a Canvas (the kit has no chart).
 * A tap picks a bucket and shows [detail] under the chart; [description] carries every number for TalkBack.
 */
@Composable
internal fun BucketChart(
    labels: List<String>,
    bars: List<ChartSeries>,
    lines: List<ChartSeries>,
    areas: Boolean,
    formatY: (Double) -> String,
    description: String,
    detail: (Int) -> String,
    height: Dp = 200.dp,
) {
    val colors = SkTheme.colors
    var picked by remember(labels) { mutableStateOf<Int?>(null) }
    val measurer = rememberTextMeasurer()
    val all = (bars + lines).flatMap { it.values }
    val scale = AnalyticsFormat.scale(all.minOrNull() ?: 0.0, all.maxOrNull() ?: 0.0)
    val muted = colors.textMuted.color
    val grid = colors.inset.color
    val label = TextStyle(fontSize = 10.sp, color = muted)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height)
                .semantics { contentDescription = description }
                .pointerInput(labels) {
                    detectTapGestures { at ->
                        val left = AxisWidth.toPx()
                        val fraction = (at.x - left) / (size.width - left)
                        picked = AnalyticsFormat.nearest(fraction, labels.size)
                    }
                },
        ) {
            val plot =
                Plot(
                    AxisWidth.toPx(),
                    4.dp.toPx(),
                    size.width - AxisWidth.toPx(),
                    size.height - 22.dp.toPx() - 4.dp.toPx(),
                    scale,
                )
            drawAxes(plot, measurer, label, grid, labels, formatY)
            picked?.let {
                drawRect(
                    grid.copy(alpha = 0.6f),
                    Offset(plot.left + plot.slot(labels.size) * it, plot.top),
                    Size(plot.slot(labels.size), plot.height),
                )
            }
            bars.forEachIndexed { index, series -> drawBars(plot, series, index, bars.size, labels.size) }
            lines.forEach { drawLine(plot, it, labels.size, areas) }
        }
        picked?.let { Text(detail(it), style = SkTypography.footnote, color = colors.text.color) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            (bars + lines).forEach { LegendDot(it.name, it.color) }
        }
    }
}

private class Plot(
    val left: Float,
    val top: Float,
    val width: Float,
    val height: Float,
    val scale: AnalyticsFormat.Scale,
) {
    fun y(value: Double): Float = top + height * (1f - ((value - scale.min) / (scale.max - scale.min)).toFloat())

    fun slot(count: Int): Float = width / count

    fun center(
        index: Int,
        count: Int,
    ): Float = left + slot(count) * (index + 0.5f)
}

private fun DrawScope.drawAxes(
    plot: Plot,
    measurer: TextMeasurer,
    style: TextStyle,
    grid: Color,
    labels: List<String>,
    formatY: (Double) -> String,
) {
    plot.scale.ticks.forEach { tick ->
        val y = plot.y(tick)
        drawLine(grid, Offset(plot.left, y), Offset(plot.left + plot.width, y), strokeWidth = 1.dp.toPx())
        val text = measurer.measure(formatY(tick), style, maxLines = 1)
        drawText(text, topLeft = Offset(plot.left - text.size.width - 6.dp.toPx(), y - text.size.height / 2f))
    }
    val every = ceil(labels.size / LABEL_SLOTS).toInt().coerceAtLeast(1)
    labels.forEachIndexed { index, name ->
        if (index % every != 0) return@forEachIndexed
        val text = measurer.measure(name, style, maxLines = 1)
        val x = (plot.center(index, labels.size) - text.size.width / 2f).coerceIn(0f, size.width - text.size.width)
        drawText(text, topLeft = Offset(x, plot.top + plot.height + 4.dp.toPx()))
    }
}

private fun DrawScope.drawBars(
    plot: Plot,
    series: ChartSeries,
    index: Int,
    groups: Int,
    count: Int,
) {
    val group = plot.slot(count) * 0.72f
    val bar = group / groups
    val zero = plot.y(0.0)
    series.values.forEachIndexed { i, value ->
        val x = plot.center(i, count) - group / 2f + bar * index
        val y = plot.y(value)
        val top = minOf(y, zero)
        drawRoundRect(
            series.color,
            Offset(x + 1.dp.toPx(), top),
            Size((bar - 2.dp.toPx()).coerceAtLeast(1f), kotlin.math.abs(zero - y).coerceAtLeast(1f)),
            CornerRadius(3.dp.toPx()),
        )
    }
}

private fun DrawScope.drawLine(
    plot: Plot,
    series: ChartSeries,
    count: Int,
    area: Boolean,
) {
    val points = series.values.mapIndexed { i, v -> Offset(plot.center(i, count), plot.y(v)) }
    if (points.isEmpty()) return
    if (area && points.size > 1) {
        val fill =
            Path().apply {
                moveTo(points.first().x, plot.y(0.0))
                points.forEach { lineTo(it.x, it.y) }
                lineTo(points.last().x, plot.y(0.0))
                close()
            }
        drawPath(fill, series.color.copy(alpha = 0.14f))
    }
    val path =
        Path().apply {
            moveTo(points.first().x, points.first().y)
            points.drop(1).forEach { lineTo(it.x, it.y) }
        }
    drawPath(path, series.color, style = Stroke(2.5.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
    points.forEach { drawCircle(series.color, 3.5.dp.toPx(), it) }
}
