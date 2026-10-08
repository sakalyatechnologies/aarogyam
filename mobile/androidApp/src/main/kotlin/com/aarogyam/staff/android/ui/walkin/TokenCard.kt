package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.queue.QueueRow
import com.aarogyam.staff.queue.QueueState
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.queue.TokenStatus
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** One token: number, patient, wait and doctor, with the moves its status allows. */
@Composable
internal fun TokenCard(
    row: QueueRow,
    state: QueueState.Loaded,
    holder: QueueStateHolder,
) {
    SkCard {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            Text(
                stringResource(R.string.queue_token, row.tokenNumber),
                style = SkTypography.number,
                color = SkTheme.colors.primary.color,
            )
            Column(Modifier.weight(1f)) {
                Text(row.name, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
                val age = row.ageYears?.let { stringResource(R.string.age_years, it) }
                val sex = row.sex.label()?.let { stringResource(it) }
                val wait =
                    if (row.status.active) {
                        stringResource(
                            R.string.queue_wait_minutes,
                            row.waitMinutes.toInt(),
                        )
                    } else {
                        null
                    }
                Text(
                    listOfNotNull(row.number, age, sex, row.doctor, wait).joinToString(" · "),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.textMuted.color,
                )
            }
            SkChip(stringResource(row.status.label()), tone = row.status.tone())
        }
        if (row.status.active && (state.canMove || state.canStartVisit)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp), modifier = Modifier) {
                if (state.canStartVisit) {
                    Action(
                        R.string.queue_start_visit,
                        row,
                        SkButtonVariant.Primary,
                    ) { holder.startVisit(row.id) }
                }
                if (state.canMove && row.status == TokenStatus.Waiting && !state.canStartVisit) {
                    Action(R.string.queue_seat, row, SkButtonVariant.Primary) { holder.seat(row.id) }
                }
                if (state.canMove) {
                    Action(R.string.queue_done, row, SkButtonVariant.Secondary) { holder.done(row.id) }
                    Action(R.string.queue_left, row, SkButtonVariant.Secondary) { holder.left(row.id) }
                }
            }
        }
    }
}

@Composable
private fun Action(
    text: Int,
    row: QueueRow,
    variant: SkButtonVariant,
    onClick: () -> Unit,
) = SkButton(stringResource(text), onClick = onClick, variant = variant, enabled = !row.busy)

private fun TokenStatus.label(): Int =
    when (this) {
        TokenStatus.Waiting, TokenStatus.Unknown -> R.string.queue_status_waiting
        TokenStatus.InChair -> R.string.queue_status_in_chair
        TokenStatus.Done -> R.string.queue_status_done
        TokenStatus.Left -> R.string.queue_status_left
    }

private fun TokenStatus.tone(): SkTone =
    when (this) {
        TokenStatus.Waiting, TokenStatus.Unknown -> SkTone.Warning
        TokenStatus.InChair -> SkTone.Info
        TokenStatus.Done -> SkTone.Success
        TokenStatus.Left -> SkTone.Neutral
    }
