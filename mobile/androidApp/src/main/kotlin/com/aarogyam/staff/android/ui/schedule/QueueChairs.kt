package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.queue.QueueRow
import com.aarogyam.staff.queue.QueueState
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.queue.TokenStatus
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

private val CARD_RADIUS = 22.dp

/** "Now serving": chairs in use, then the empty ones with "Seat next". */
@Composable
internal fun ChairRow(
    s: QueueState.Loaded,
    holder: QueueStateHolder,
    onOpenPatient: (String) -> Unit,
) {
    val waiting = s.rows.filter { it.status == TokenStatus.Waiting }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        s.board.forEach { slot ->
            val row = slot.occupant
            val chair = slot.chair
            if (row != null) {
                ChairCard(row, chair?.name, s.canMove, { onOpenPatient(row.patientId) }) { holder.done(row.id) }
            } else {
                val canSeat = s.canMove && waiting.any { chair == null || it.branchId == chair.branchId }
                FreeChairCard(chair?.name, canSeat) { holder.seatNextIn(chair?.id) }
            }
        }
    }
}

private val kicker = v7(10.5f, FontWeight.Bold).copy(fontFamily = FontFamily.Monospace, letterSpacing = 0.6.sp)

@Composable
private fun ChairCard(
    row: QueueRow,
    chair: String?,
    canMove: Boolean,
    onOpen: () -> Unit,
    onDone: () -> Unit,
) {
    val p = SkTheme.palette
    val ink = p.onPrimary.color
    Column(
        Modifier
            .width(132.dp)
            .defaultMinSize(minHeight = 96.dp)
            .background(p.primary.color, RoundedCornerShape(CARD_RADIUS))
            .clickable(enabled = !row.busy, role = Role.Button, onClick = onOpen)
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        val kick =
            chair?.let { stringResource(R.string.sh_s_q_chair_token, it, row.tokenNumber) }
                ?: stringResource(R.string.sh_s_q_in_chair, row.tokenNumber)
        Text(
            kick.uppercase(),
            style = kicker,
            color = ink.copy(alpha = 0.8f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(row.name, style = v7(13f, FontWeight.Bold), color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        row.doctor?.let {
            Text(it, style = v7(11f), color = ink.copy(alpha = 0.8f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (canMove) {
            Text(
                stringResource(R.string.queue_done),
                style = v7(11f, FontWeight.Bold),
                color = p.primary.color,
                modifier =
                    Modifier
                        .background(Color.White, CircleShape)
                        .clickable(role = Role.Button, onClick = onDone)
                        .defaultMinSize(minHeight = 28.dp)
                        .padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun FreeChairCard(
    chair: String?,
    canSeat: Boolean,
    onSeat: () -> Unit,
) {
    val p = SkTheme.palette
    val outline = p.outline.color
    val density = androidx.compose.ui.platform.LocalDensity.current
    Column(
        Modifier
            .width(132.dp)
            .defaultMinSize(minHeight = 96.dp)
            .drawBehind {
                val w = with(density) { 1.5.dp.toPx() }
                drawRoundRect(
                    outline,
                    cornerRadius = CornerRadius(CARD_RADIUS.toPx()),
                    style =
                        Stroke(
                            w,
                            pathEffect =
                                PathEffect.dashPathEffect(
                                    floatArrayOf(
                                        5f * density.density,
                                        4f * density.density,
                                    ),
                                ),
                        ),
                )
            }.clickable(enabled = canSeat, role = Role.Button, onClick = onSeat)
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            (chair ?: stringResource(R.string.sh_s_q_free_chair)).uppercase(),
            style = kicker,
            color = p.onSurface.color.copy(alpha = 0.8f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(stringResource(R.string.sh_s_q_free), style = v7(13f, FontWeight.Bold), color = p.onSurface.color)
        if (canSeat) {
            Text(
                stringResource(R.string.sh_s_q_seat_next),
                style = v7(11f, FontWeight.Bold),
                color = p.primary.color,
            )
        }
    }
}
