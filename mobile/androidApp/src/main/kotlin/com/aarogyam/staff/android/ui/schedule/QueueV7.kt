package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.today.SectionHeader
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.queue.QueueRow
import com.aarogyam.staff.queue.QueueState
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.queue.QueueSummary
import com.aarogyam.staff.queue.TokenStatus
import com.aarogyam.staff.queue.VisitOpened
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTicket
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay

private const val TICK_MILLIS = 30_000L

/** The Queue view of Schedule: chair board, "Waiting" tickets with live timers and the day's summary chips. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueV7(
    holder: QueueStateHolder,
    onWalkIn: () -> Unit,
    onOpenVisit: (VisitOpened) -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(holder) { holder.opened.collect(onOpenVisit) }
    val loaded = state as? QueueState.Loaded
    PullToRefreshBox(loaded?.refreshing == true, holder::refresh, Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.L.dp)
                .padding(bottom = Spacing.XXL.dp),
        ) {
            when (val s = state) {
                QueueState.Loading -> {
                    LoadingIndicator()
                }

                QueueState.NotAllowed -> {
                    SkEmptyState(
                        stringResource(R.string.queue_not_allowed_title),
                        stringResource(R.string.queue_not_allowed_message),
                    )
                }

                is QueueState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.queue_title),
                        stringResource(s.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is QueueState.Loaded -> {
                    Board(s, holder, onWalkIn, onOpenPatient)
                }
            }
        }
    }
}

@Composable
private fun Board(
    s: QueueState.Loaded,
    holder: QueueStateHolder,
    onWalkIn: () -> Unit,
    onOpenPatient: (String) -> Unit,
) {
    val waiting = s.rows.filter { it.status == TokenStatus.Waiting || it.status == TokenStatus.Called }
    val toBill = s.rows.filter { it.status == TokenStatus.ReadyToBill }
    s.actionError?.let {
        Text(
            stringResource(it.message()),
            style = v7(12f),
            color = SkTheme.palette.error.color,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
    ArrivalsStrip(holder.arrivals)
    SectionHeader(stringResource(R.string.sh_s_q_now))
    ChairRow(s, holder, onOpenPatient)
    SectionHeader(
        pluralStringResource(R.plurals.sh_s_q_waiting, waiting.size, waiting.size),
        stringResource(R.string.sh_s_q_walk_in),
        onWalkIn,
    )
    if (waiting.isEmpty()) {
        Text(stringResource(R.string.sh_s_q_nobody), style = v7(14f), color = SkTheme.palette.onSurfaceVariant.color)
    }
    val signature = s.rows.joinToString(",") { "${it.id}${it.waitMinutes}${it.status}" }
    var readAt by remember(signature) { mutableLongStateOf(System.currentTimeMillis()) }
    var now by remember(signature) { mutableLongStateOf(readAt) }
    LaunchedEffect(signature) {
        while (true) {
            delay(TICK_MILLIS)
            now = System.currentTimeMillis()
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        waiting.forEach { Ticket(it, s, holder, now - readAt) }
        toBill.forEach { Ticket(it, s, holder, 0) }
    }
    Summary(s.rows, s.noShows)
}

@Composable
private fun Ticket(
    row: QueueRow,
    s: QueueState.Loaded,
    holder: QueueStateHolder,
    elapsed: Long,
) {
    val minutes = QueueBoard.waitMinutes(row.waitMinutes.toInt(), elapsed)
    val age = row.ageYears?.let { stringResource(R.string.age_years, it) }
    val sex = if (row.sex == Sex.Unknown) null else row.sex.label()?.let { stringResource(it) }
    SkTicket(
        number = "#${row.tokenNumber}",
        title = row.name,
        subtitle =
            listOfNotNull(
                listOfNotNull(row.number, age, sex).joinToString(" · "),
                row.doctor,
            ).joinToString(" · "),
        badge =
            if (row.status == TokenStatus.Waiting) {
                pluralStringResource(R.plurals.sh_s_q_wait, minutes, minutes)
            } else {
                stringResource(row.status.badge())
            },
    ) {
        when {
            row.status == TokenStatus.ReadyToBill -> {}

            s.canStartVisit -> {
                SkPillButton(
                    stringResource(R.string.queue_start_visit),
                    { holder.startVisit(row.id) },
                    variant = SkPillVariant.Tonal,
                    enabled = !row.busy,
                )
            }

            s.canMove -> {
                SkPillButton(
                    stringResource(R.string.queue_seat),
                    { holder.seat(row.id) },
                    variant = SkPillVariant.Tonal,
                    enabled = !row.busy,
                )
            }
        }
    }
}

private fun TokenStatus.badge(): Int =
    when (this) {
        TokenStatus.Waiting, TokenStatus.Unknown -> R.string.queue_status_waiting
        TokenStatus.Called -> R.string.queue_status_called
        TokenStatus.InChair -> R.string.queue_status_in_chair
        TokenStatus.ReadyToBill -> R.string.queue_status_ready_to_bill
        TokenStatus.Done -> R.string.queue_status_done
        TokenStatus.Left -> R.string.queue_status_left
    }

@Composable
private fun Summary(
    rows: List<QueueRow>,
    noShows: Int?,
) {
    val s = QueueSummary.of(rows)
    val p = SkTheme.palette
    val chips =
        listOfNotNull(
            pluralStringResource(R.plurals.sh_s_q_done_today, s.done, s.done),
            s.averageWaitMinutes?.let { pluralStringResource(R.plurals.sh_s_q_avg_wait, it, it) },
            if (s.left > 0) pluralStringResource(R.plurals.sh_s_q_left, s.left, s.left) else null,
            noShows?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.sh_s_q_no_shows, it, it) },
        )
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        androidx.compose.foundation.layout.FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            chips.forEachIndexed { index, chip ->
                val first = index == 0
                Text(
                    chip,
                    style = v7(12.5f, androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = (if (first) p.onPrimaryContainer else p.onSurfaceVariant).color,
                    modifier =
                        Modifier
                            .background((if (first) p.primaryContainer else p.surface3).color, CircleShape)
                            .padding(horizontal = 11.dp, vertical = 7.dp),
                )
            }
        }
    }
}
