package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.prescriptions.DoseSlot
import com.aarogyam.staff.prescriptions.RxTiming
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
private fun RxTiming.title(): String =
    stringResource(
        when (this) {
            RxTiming.BeforeFood -> R.string.p9_timing_before_food
            RxTiming.AfterFood -> R.string.p9_timing_after_food
            RxTiming.EmptyStomach -> R.string.p9_timing_empty_stomach
            RxTiming.Bedtime -> R.string.p9_timing_bedtime
            RxTiming.Sos -> R.string.p9_timing_sos
            RxTiming.AsDirected -> R.string.p9_timing_as_directed
        },
    )

@Composable
private fun DoseSlot.title(): String =
    stringResource(
        when (this) {
            DoseSlot.Morning -> R.string.p9_dose_morning
            DoseSlot.Afternoon -> R.string.p9_dose_afternoon
            DoseSlot.Night -> R.string.p9_dose_night
        },
    )

@Composable
private fun totalText(display: DoseDisplay): String? {
    val total = display.total ?: return null
    val capsule = display.form?.lowercase()?.startsWith("cap") == true
    val one = total == 1
    val unit =
        stringResource(
            when {
                capsule && one -> R.string.p9_unit_capsule
                capsule -> R.string.p9_unit_capsules
                one -> R.string.p9_unit_tablet
                else -> R.string.p9_unit_tablets
            },
        )
    return (if (display.upTo) stringResource(R.string.p9_dose_up_to) + " " else "") + total + " " + unit
}

/** One medicine: name, kind and timing, the morning, afternoon and night cells, then the days and the total. */
@Composable
internal fun MedicineCard(
    name: String,
    form: String?,
    display: DoseDisplay,
) {
    val p = SkTheme.palette
    val timing = display.timing?.title() ?: display.rawTiming
    Column(
        Modifier.fillMaxWidth().background(p.surface2.color, RoundedCornerShape(18.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(name, style = v7(14f, FontWeight.Bold), color = p.onSurface.color)
                val line =
                    listOfNotNull(
                        form?.replaceFirstChar { it.uppercase() },
                        timing,
                    ).joinToString(" · ")
                if (line.isNotEmpty()) Text(line, style = v7(12f), color = p.onSurfaceVariant.color)
            }
            if (display.frequency.isNotEmpty()) V7Pill(display.frequency, PillKind.Neutral)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            display.cells.forEach { cell ->
                val label = cell.slot.title()
                Column(
                    Modifier
                        .weight(1f)
                        .defaultMinSize(minHeight = 52.dp)
                        .background((if (cell.on) p.primaryContainer else p.surface3).color, RoundedCornerShape(14.dp))
                        .clearAndSetSemantics { contentDescription = "$label: ${cell.value}" },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    val ink = (if (cell.on) p.onPrimaryContainer else p.onSurfaceVariant).color
                    Text(
                        label,
                        style = v7(10.5f, FontWeight.Bold),
                        color = ink,
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                    Text(cell.value, style = v7(17f, FontWeight.ExtraBold), color = ink)
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            display.days?.let {
                Text(
                    stringResource(R.string.p9_dose_days, it),
                    style = v7(12.5f),
                    color = p.onSurfaceVariant.color,
                    modifier = Modifier.weight(1f),
                )
            } ?: Spacer(Modifier.weight(1f))
            totalText(display)?.let { Text(it, style = v7(12.5f, FontWeight.Bold), color = p.onSurfaceVariant.color) }
        }
    }
}
