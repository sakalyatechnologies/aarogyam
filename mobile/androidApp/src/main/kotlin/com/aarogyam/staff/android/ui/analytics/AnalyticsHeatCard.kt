package com.aarogyam.staff.android.ui.analytics

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.analytics.AnalyticsView
import com.aarogyam.staff.analytics.HeatUnit
import com.aarogyam.staff.android.R
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Weekday rows by clinic hour; darker is busier. Booked chair minutes, or visits when the server sent no occupancy. */
@Composable
internal fun HeatCard(view: AnalyticsView) {
    val colors = SkTheme.colors
    val minutes = view.heatUnit == HeatUnit.BookedMinutes
    val title = if (minutes) R.string.an_heat_title else R.string.an_heat_visits_title
    val sub = if (minutes) R.string.an_heat_sub else R.string.an_heat_visits_sub
    val format = if (minutes) R.string.an_heat_a11y_minutes else R.string.an_heat_a11y_visits
    var picked by remember(view) { mutableStateOf<Pair<Int, Int>?>(null) }
    ChartCard(stringResource(title), stringResource(sub)) {
        if (view.heat.isEmpty()) {
            CardNote(stringResource(R.string.an_c_no_data))
        } else {
            val grid = AnalyticsFormat.heat(view.heat)
            val days = AnalyticsFormat.weekdays()
            val texts =
                days.indices.map { row ->
                    grid.hours.indices.map { column ->
                        stringResource(format, days[row], grid.hours[column], grid.values[row][column])
                    }
                }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    Box(Modifier.width(32.dp))
                    grid.hours.forEach { hour ->
                        Text(
                            if (hour % 2 == 0) hour.toString() else "",
                            style = SkTypography.caption,
                            color = colors.textMuted.color,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            softWrap = false,
                            modifier = Modifier.weight(1f).clearAndSetSemantics {},
                        )
                    }
                }
                days.forEachIndexed { row, day ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            day,
                            style = SkTypography.caption,
                            color = colors.textMuted.color,
                            modifier =
                                Modifier
                                    .width(
                                        32.dp,
                                    ).clearAndSetSemantics {
                                    },
                        )
                        grid.hours.indices.forEach { column ->
                            val load = grid.loads[row][column]
                            val description = texts[row][column]
                            val on = picked == row to column
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(26.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(
                                        if (load <=
                                            0f
                                        ) {
                                            colors.inset.color
                                        } else {
                                            colors.primary.color.copy(
                                                alpha =
                                                    0.15f + 0.85f * load,
                                            )
                                        },
                                    ).then(
                                        if (on) {
                                            Modifier.border(
                                                2.dp,
                                                colors.text.color,
                                                RoundedCornerShape(4.dp),
                                            )
                                        } else {
                                            Modifier
                                        },
                                    ).semantics {
                                        contentDescription = description
                                        role = Role.Button
                                    }.clickable { picked = row to column },
                            )
                        }
                    }
                }
            }
            picked?.let { (row, column) ->
                Text(texts[row][column], style = SkTypography.footnote, color = colors.text.color)
            }
            Row(
                Modifier.fillMaxWidth().clearAndSetSemantics {
                },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.an_c_heat_quiet),
                    style = SkTypography.caption,
                    color = colors.textMuted.color,
                )
                listOf(0.15f, 0.4f, 0.65f, 1f).forEach {
                    Box(
                        Modifier
                            .width(
                                22.dp,
                            ).height(10.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(colors.primary.color.copy(alpha = it)),
                    )
                }
                Text(
                    stringResource(R.string.an_c_heat_full),
                    style = SkTypography.caption,
                    color = colors.textMuted.color,
                )
            }
        }
    }
}
