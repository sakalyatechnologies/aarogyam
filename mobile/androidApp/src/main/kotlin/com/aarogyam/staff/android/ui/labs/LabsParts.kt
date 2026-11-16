package com.aarogyam.staff.android.ui.labs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.labs.LabCase
import com.aarogyam.staff.labs.LabRow
import com.aarogyam.staff.labs.LabStatus
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** `LAB-12 · Crown, Bridge`. */
fun LabCase.titleText(): String = ClinicalFormat.joinDot(listOf(number, work.joinToString(", ")))

/** `Precision Dental · teeth 46, 47 · due 18 Oct`, leaving out what is missing. */
@Composable
fun LabCase.detailText(): String =
    ClinicalFormat.joinDot(
        listOf(
            labName,
            teeth.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.cn_pv_lab_teeth, it.joinToString(", ")) },
            dueOn?.let { stringResource(R.string.cn_pv_lab_due, ClinicalFormat.date(it)) },
        ),
    )

/** `Pune · ~5 days · Crown, Aligner`, leaving out what is missing. */
@Composable
fun LabRow.infoLine(): String =
    ClinicalFormat.joinDot(
        listOf(
            city,
            turnaroundDays?.takeIf { it > 0 }?.let { stringResource(R.string.cn_lv_vendor_days, it) },
            workTypes.joinToString(", "),
        ),
    )

/** The status pill: Ready once back, At lab while out, Rework, and Overdue when out past its date. */
@Composable
fun StatusPill(
    status: LabStatus,
    overdue: Boolean,
) {
    val (text, tone) =
        if (overdue && status.open) {
            R.string.cn_pv_lab_overdue to SkTone.Danger
        } else {
            when (status) {
                LabStatus.Received, LabStatus.Fitted -> R.string.cn_pv_lab_ready to SkTone.Success
                LabStatus.Sent, LabStatus.InProgress -> R.string.cn_pv_lab_at_lab to SkTone.Neutral
                LabStatus.Rework -> R.string.cn_pv_lab_rework to SkTone.Danger
                LabStatus.Draft -> R.string.cn_pv_lab_draft to SkTone.Neutral
                LabStatus.Cancelled -> R.string.cn_pv_lab_cancelled to SkTone.Neutral
            }
        }
    SkChip(stringResource(text), tone = tone)
}

/** One case: its title and detail, the status pill and the tracker stage. */
@Composable
fun LabCaseRow(
    item: LabCase,
    overdue: Boolean,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    Box(Modifier.background(colors.card.color, RoundedCornerShape(16.dp))) {
        SkListRow(
            title = item.titleText(),
            subtitle = item.patientName + "\n" + item.detailText(),
            onClick = onClick,
            trailing = {
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    StatusPill(item.status, overdue)
                    item.tracker?.let { SkChip(stringResource(stageTitle(it.ordinal)), tone = SkTone.Success) }
                }
            },
        )
    }
}

/** The five-step tracker: done, current, to come. */
@Composable
fun LabTracker(current: Int?) {
    val colors = SkTheme.colors
    val steps = trackerSteps(current)
    Row(Modifier.fillMaxWidth()) {
        steps.forEachIndexed { index, step ->
            val title = stringResource(stageTitle(index))
            val word =
                stringResource(
                    when (step) {
                        TrackerStep.Done -> R.string.cn_lv_tracker_done
                        TrackerStep.Current -> R.string.cn_lv_tracker_current
                        TrackerStep.Todo -> R.string.cn_lv_tracker_todo
                    },
                )
            val a11y = stringResource(R.string.cn_lv_tracker_step, index + 1, title, word)
            Column(
                Modifier.weight(1f).clearAndSetSemantics { contentDescription = a11y },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                val dot = Modifier.size(22.dp)
                when (step) {
                    TrackerStep.Done -> {
                        Box(dot.background(colors.primary.color, CircleShape), Alignment.Center) {
                            Text("✓", color = colors.onPrimary.color, style = SkTypography.caption)
                        }
                    }

                    TrackerStep.Current -> {
                        Box(
                            dot
                                .background(
                                    colors.brandSoft.color,
                                    CircleShape,
                                ).border(2.dp, colors.primary.color, CircleShape),
                            Alignment.Center,
                        ) {
                            Box(Modifier.size(8.dp).background(colors.primary.color, CircleShape))
                        }
                    }

                    TrackerStep.Todo -> {
                        Box(dot.border(1.5.dp, colors.rule.color, CircleShape))
                    }
                }
                Text(
                    title,
                    style = SkTypography.caption,
                    color = (if (step == TrackerStep.Todo) colors.textMuted else colors.text).color,
                    maxLines = 1,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
fun SectionLabel(text: String) {
    Text(text, style = SkTypography.label, color = SkTheme.colors.textMuted.color, modifier = Modifier)
}
