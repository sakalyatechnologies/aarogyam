package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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

/** One row per chair: booked against open time over the range, with the percent. */
@Composable
internal fun ChairsCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    ChartCard(stringResource(R.string.an_chairs_title), stringResource(R.string.an_chairs_sub)) {
        if (view.chairs.isEmpty()) {
            CardNote(stringResource(R.string.an_chairs_none))
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                view.chairs.forEach { chair ->
                    val booked = chair.percent.coerceIn(0, 100) / 100f
                    val description =
                        stringResource(
                            R.string.an_chairs_a11y,
                            chair.name,
                            chair.percent,
                            chair.bookedMinutes.toInt(),
                            chair.openMinutes.toInt(),
                        )
                    Column(
                        Modifier.clearAndSetSemantics {
                            contentDescription = description
                        },
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                chair.name,
                                style = SkTypography.label,
                                color = colors.text.color,
                                maxLines = 1,
                                modifier = Modifier.weight(1f),
                            )
                            Text("${chair.percent}%", style = SkTypography.bodyStrong, color = colors.text.color)
                        }
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(
                                    14.dp,
                                ).clip(RoundedCornerShape(7.dp))
                                .background(colors.inset.color),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(
                                        booked,
                                    ).height(14.dp)
                                    .clip(RoundedCornerShape(7.dp))
                                    .background(colors.primary.color),
                            )
                        }
                    }
                }
            }
            Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                LegendDot(stringResource(R.string.an_chairs_booked), colors.primary.color)
                LegendDot(stringResource(R.string.an_chairs_open), colors.inset.color)
            }
        }
    }
}

/** Booked chair minutes split into treatment, consults and admin, as a donut with a key. */
@Composable
internal fun ChairTimeCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val palette = listOf(colors.primary.color, colors.warning.color, colors.info.color)
    val names =
        view.chairTime.map {
            stringResource(
                when (it.key) {
                    "treatment" -> R.string.an_split_treatment
                    "consult" -> R.string.an_split_consult
                    else -> R.string.an_split_admin
                },
            )
        }
    ChartCard(stringResource(R.string.an_split_title), stringResource(R.string.an_split_sub)) {
        if (view.chairTime.isEmpty()) {
            CardNote(stringResource(R.string.an_c_no_data))
        } else {
            val description =
                view.chairTime
                    .mapIndexed {
                        i,
                        s,
                        ->
                        stringResource(R.string.an_split_a11y, names[i], s.percent, s.minutes.toInt())
                    }.joinToString(". ")
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                val total =
                    view.chairTime
                        .sumOf { it.minutes }
                        .coerceAtLeast(1L)
                        .toFloat()
                Canvas(Modifier.size(120.dp).semantics { contentDescription = description }) {
                    val stroke = 22.dp.toPx()
                    val box = Size(size.width - stroke, size.height - stroke)
                    var start = -90f
                    view.chairTime.forEachIndexed { i, slice ->
                        val sweep = 360f * slice.minutes / total
                        drawArc(
                            palette[i % palette.size],
                            start,
                            (sweep - 2f).coerceAtLeast(0.5f),
                            false,
                            Offset(stroke / 2, stroke / 2),
                            box,
                            style = Stroke(stroke),
                        )
                        start += sweep
                    }
                }
                Column(Modifier.clearAndSetSemantics {}, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    view.chairTime.forEachIndexed { i, slice ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.width(10.dp))
                            LegendDot(names[i], palette[i % palette.size], "${slice.percent}%")
                        }
                    }
                }
            }
        }
    }
}
