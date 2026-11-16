package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Procedures done by category, most often first; the amount joins the count when money is visible. */
@Composable
internal fun ProceduresCard(view: AnalyticsView) {
    ChartCard(stringResource(R.string.an_proc_title), stringResource(R.string.an_proc_sub)) {
        if (view.procedures.isEmpty()) {
            CardNote(stringResource(R.string.an_proc_none))
        } else {
            ShareRows(
                view.procedures.map {
                    val name = AnalyticsFormat.keyText(it.key)
                    val amount = it.amountPaise?.let(AnalyticsFormat::rupees)
                    ShareRow(
                        name,
                        it.count,
                        if (amount != null) "${it.count} · $amount" else it.count.toString(),
                        if (amount != null) {
                            stringResource(R.string.an_proc_a11y_amount, name, it.count.toInt(), amount)
                        } else {
                            stringResource(R.string.an_proc_a11y, name, it.count.toInt())
                        },
                    )
                },
                SkTheme.colors.primary.color,
            )
        }
    }
}

/** Visit kinds on a radar with their shares beside it. */
@Composable
internal fun MixCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val top = AnalyticsFormat.radar(view.visitKinds.map { it.key to it.value })
    ChartCard(stringResource(R.string.an_c_mix), stringResource(R.string.an_c_mix_sub)) {
        if (top == null) {
            CardNote(stringResource(R.string.an_c_no_data))
        } else {
            val total = top.sumOf { it.second }.coerceAtLeast(1L)
            val rows = top.map { AnalyticsFormat.keyText(it.first) to AnalyticsFormat.percentOf(it.second, total) }
            val description =
                stringResource(R.string.an_c_mix_a11y, top.size) + ". " +
                    rows.joinToString(". ") { "${it.first} ${it.second}%" }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Radar(
                    top.map { it.second.toFloat() },
                    Modifier.size(120.dp).semantics {
                        contentDescription =
                            description
                    },
                )
                Column(Modifier.weight(1f).clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    rows.forEach { (name, percent) ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                name,
                                style = SkTypography.footnote,
                                color = colors.text.color,
                                maxLines = 2,
                                modifier = Modifier.weight(1f),
                            )
                            Text("$percent%", style = SkTypography.bodyStrong, color = colors.text.color)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Radar(
    values: List<Float>,
    modifier: Modifier,
) {
    val colors = SkTheme.colors
    val grid = colors.inset.color
    val tint = colors.primary.color
    Canvas(modifier) {
        val centre = Offset(size.width / 2, size.height / 2)
        val radius = size.minDimension / 2 - 6.dp.toPx()
        val peak = values.max().coerceAtLeast(1f)

        fun point(
            index: Int,
            scale: Float,
        ): Offset {
            val angle = -PI / 2 + 2 * PI * index / values.size
            return Offset(
                centre.x + (radius * scale * cos(angle)).toFloat(),
                centre.y + (radius * scale * sin(angle)).toFloat(),
            )
        }
        listOf(1f / 3, 2f / 3, 1f).forEach { ring ->
            val path =
                Path().apply {
                    values.indices.forEach { i ->
                        point(i, ring).let {
                            if (i ==
                                0
                            ) {
                                moveTo(it.x, it.y)
                            } else {
                                lineTo(it.x, it.y)
                            }
                        }
                    }
                    close()
                }
            drawPath(path, grid, style = Stroke(1.dp.toPx()))
        }
        values.indices.forEach { drawLine(grid, centre, point(it, 1f), 1.dp.toPx()) }
        val shape =
            Path().apply {
                values.forEachIndexed { i, v ->
                    point(i, v / peak).let {
                        if (i ==
                            0
                        ) {
                            moveTo(it.x, it.y)
                        } else {
                            lineTo(it.x, it.y)
                        }
                    }
                }
                close()
            }
        drawPath(shape, tint.copy(alpha = 0.22f))
        drawPath(shape, tint, style = Stroke(2.dp.toPx()))
    }
}
