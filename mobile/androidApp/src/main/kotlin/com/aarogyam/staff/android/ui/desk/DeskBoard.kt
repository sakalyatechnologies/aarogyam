package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.visit.WhatsAppSummary
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.desk.BoardTicket
import com.aarogyam.staff.desk.DeskBoardState
import com.aarogyam.staff.desk.DeskBoardStateHolder
import com.aarogyam.staff.desk.PatientState
import com.aarogyam.staff.desk.REMIND_AGAIN_AFTER_SECONDS
import com.aarogyam.staff.desk.WelcomeNote
import com.sakalya.mobile.design.Radii
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlin.time.Instant

/** What the board reads from the desk and what it can do (the v10 live bits). */
class DeskBoardContext(
    val clinic: ClinicContext,
    val roleKey: String,
    val permissions: Set<String>,
    val feed: DeskFeedState,
    val remind: (String) -> Unit,
    val online: Boolean,
    val onOpenPatient: (String) -> Unit,
    val onCollect: (DeskPayTarget) -> Unit,
)

/**
 * The waiting-room board: today's patients grouped by where they are. A doctor's "Send in" calls the patient in;
 * "My patients" filters to their own. Drawn inside the caller's scrolling column.
 */
@Composable
fun DeskBoardContent(
    holder: DeskBoardStateHolder,
    state: DeskBoardState,
    ctx: DeskBoardContext,
) {
    when (state) {
        DeskBoardState.Loading -> {
            LoadingIndicator()
        }

        DeskBoardState.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.dk_d9_board_not_allowed_title),
                stringResource(R.string.dk_d9_board_not_allowed_message),
            )
        }

        is DeskBoardState.Failed -> {
            SkEmptyState(
                stringResource(R.string.dk_d9_board_title),
                stringResource(state.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = holder::refresh,
            )
        }

        is DeskBoardState.Loaded -> {
            LoadedBoard(holder, state, ctx)
        }
    }
}

@Composable
private fun LoadedBoard(
    holder: DeskBoardStateHolder,
    loaded: DeskBoardState.Loaded,
    ctx: DeskBoardContext,
) {
    val now by rememberNow()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        if (loaded.canFilterMine) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.dk_d9_board_mine),
                    Modifier.weight(1f),
                    style = SkTypography.bodyStrong,
                    color = SkTheme.colors.text.color,
                )
                Switch(
                    loaded.mine,
                    holder::setMine,
                    colors = SwitchDefaults.colors(checkedTrackColor = SkTheme.colors.primary.color),
                )
            }
        }
        when {
            loaded.error != null && ctx.online -> DeskNotice(stringResource(R.string.dk_d9_board_refresh_failed))
            !ctx.online -> DeskNotice(stringResource(R.string.dk_d9_board_offline))
        }
        val called = loaded.tickets.filter { it.state == PatientState.Called }
        if (DeskBoardRules.showsCalledBanner(ctx.roleKey, called.size)) CalledBanner(called)
        DeskBoardRules.order.forEach { group ->
            BoardSection(group, loaded.tickets.filter { it.state == group }, loaded, holder, ctx, now)
        }
        DeskMutedText(stringResource(R.string.dk_d9_board_live))
    }
}

/** "Patient called in": the desk's alert, above the board. Token numbers only, never names. */
@Composable
private fun CalledBanner(called: List<BoardTicket>) {
    val numbers = called.map { it.tokenNumber }.sorted()
    val who =
        if (numbers.size == 1) {
            stringResource(R.string.dk_dx_called_one, numbers[0])
        } else {
            stringResource(R.string.dk_dx_called_many, numbers.joinToString(", "))
        }
    val colors = SkTheme.colors
    SkCard(Modifier.fillMaxWidth()) {
        Text(
            stringResource(R.string.dk_d9_board_banner_title),
            style = SkTypography.bodyStrong,
            color = colors.primaryText.color,
        )
        Text(who, style = SkTypography.footnote, color = colors.text.color)
    }
}

@Composable
private fun BoardSection(
    group: PatientState,
    items: List<BoardTicket>,
    loaded: DeskBoardState.Loaded,
    holder: DeskBoardStateHolder,
    ctx: DeskBoardContext,
    now: Instant,
) {
    Column(Modifier.padding(top = Spacing.XS.dp), verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        Row(
            Modifier.semantics { heading() },
            horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(group.title(), style = SkTypography.headline, color = SkTheme.colors.text.color)
            SkChip(items.size.toString())
        }
        if (items.isEmpty()) DeskMutedText(stringResource(R.string.dk_d9_board_empty))
        items.forEach { Ticket(it, loaded, holder, ctx, now) }
    }
}

@Composable
private fun welcomeText(note: WelcomeNote): String =
    stringResource(
        when (note) {
            WelcomeNote.Failed -> R.string.dk_dx_welcome_failed
            WelcomeNote.NoConsent -> R.string.dk_dx_welcome_no_consent
            WelcomeNote.OptedOut -> R.string.dk_dx_welcome_opted_out
            WelcomeNote.NoAddress -> R.string.dk_dx_welcome_no_address
            WelcomeNote.Skipped -> R.string.dk_dx_welcome_skipped
        },
    )

@Composable
private fun Ticket(
    row: BoardTicket,
    loaded: DeskBoardState.Loaded,
    holder: DeskBoardStateHolder,
    ctx: DeskBoardContext,
    now: Instant,
) {
    val wait = ctx.feed.waiting[row.id].takeIf { row.state == PatientState.Waiting }
    val seconds = wait?.let { (now - it.issuedAt).inWholeSeconds.coerceAtLeast(0) }
    val badge =
        if (wait != null && seconds != null) {
            waitingLine(wait.doctor, seconds)
        } else {
            stringResource(R.string.dk_d9_board_wait, row.waitMinutes.toInt())
        }
    val collecting =
        row.state == PatientState.ReadyToBill && DeskCollect.mayBeCollecting(ctx.feed.endedAt[row.id], now)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
        TicketCard(row, badge, loaded, holder, ctx)
        if (collecting) DeskMutedText(stringResource(R.string.dk_dx_pay_may_collect))
        row.welcome?.let { DeskMutedText(welcomeText(it)) }
        if (wait != null && seconds != null && isNoReply(seconds)) NoReplyRow(row.id, wait, ctx, now)
        // A finished visit: its WhatsApp summary, as on the Done screen (shown only with both keys).
        row.summaryVisitId?.let { WhatsAppSummary(ctx.clinic, it, compact = true) }
    }
}

@Composable
private fun waitingLine(
    doctor: String?,
    seconds: Long,
): String {
    val clock = "${seconds / SECONDS}:${(seconds % SECONDS).toString().padStart(2, '0')}"
    return if (doctor.isNullOrBlank()) {
        stringResource(R.string.dk_dx_wait_line_nodoc, clock)
    } else {
        stringResource(R.string.dk_dx_wait_line, doctorLabel(doctor), clock)
    }
}

/** The amber "Check with Dr X", then Remind (G1) or "Reminded" for the cooldown the server set. */
@Composable
private fun NoReplyRow(
    tokenId: String,
    wait: DeskWaiting,
    ctx: DeskBoardContext,
    now: Instant,
) {
    val doctor = wait.doctor?.takeIf { it.isNotBlank() }
    val check =
        if (doctor == null) {
            stringResource(R.string.dk_dx_wait_check_nodoc)
        } else {
            stringResource(R.string.dk_dx_wait_check, doctorLabel(doctor))
        }
    val remindedAt = ctx.feed.remindedAt[tokenId]
    val quiet = remindedAt != null && (now - remindedAt).inWholeSeconds < REMIND_AGAIN_AFTER_SECONDS
    val canRemind =
        ServerCaps.queueRemind && DeskCollect.canRemind(ctx.permissions)
    DeskWrap {
        SkChip(check, tone = SkTone.Warning)
        if (canRemind && !quiet) {
            val title =
                if (doctor == null) {
                    stringResource(R.string.dk_dx_wait_remind_nodoc)
                } else {
                    stringResource(R.string.dk_dx_wait_remind, doctorLabel(doctor))
                }
            SkButton(title, onClick = { ctx.remind(tokenId) }, variant = SkButtonVariant.Secondary)
        } else if (remindedAt != null) {
            DeskMutedText(stringResource(R.string.dk_dx_wait_reminded))
        }
    }
}

@Composable
private fun TicketCard(
    row: BoardTicket,
    badge: String,
    loaded: DeskBoardState.Loaded,
    holder: DeskBoardStateHolder,
    ctx: DeskBoardContext,
) {
    val colors = SkTheme.colors
    val called = row.state == PatientState.Called
    SkCard(
        Modifier
            .fillMaxWidth()
            .then(
                if (called) {
                    Modifier.border(
                        BORDER.dp,
                        colors.primary.color,
                        RoundedCornerShape(Radii.XL.dp),
                    )
                } else {
                    Modifier
                },
            ),
        onClick = { ctx.onOpenPatient(row.patientId) },
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.queue_token, row.tokenNumber),
                style = SkTypography.number,
                color = colors.primary.color,
            )
            Column(Modifier.weight(1f)) {
                Text(row.name, style = SkTypography.bodyStrong, color = colors.text.color)
                val line = listOfNotNull(patientLine(row.number, row.ageYears, row.sex), row.doctor).joinToString(" · ")
                Text(line, style = SkTypography.footnote, color = colors.textMuted.color)
                Text(badge, style = SkTypography.footnote, color = colors.textMuted.color)
            }
        }
        TicketAction(row, loaded, holder, ctx)
    }
}

@Composable
private fun TicketAction(
    row: BoardTicket,
    loaded: DeskBoardState.Loaded,
    holder: DeskBoardStateHolder,
    ctx: DeskBoardContext,
) {
    if (DeskBoardRules.showsSendIn(ctx.roleKey, row.state)) {
        SkButton(
            stringResource(R.string.dk_d9_board_send_in),
            onClick = { holder.sendIn(row.id) },
            variant = SkButtonVariant.Secondary,
            enabled = row.id !in loaded.calling,
        )
    } else if (row.state == PatientState.ReadyToBill && DeskCollect.canCollect(ctx.permissions)) {
        SkButton(
            stringResource(R.string.dk_d9_board_collect),
            onClick = {
                ctx.onCollect(
                    DeskPayTarget(
                        row.patientId,
                        row.name,
                        notificationId = ctx.feed.payNotification[row.id],
                        invoiceId = ctx.feed.payInvoice[row.id],
                    ),
                )
            },
            variant = SkButtonVariant.Secondary,
        )
    }
}

private const val SECONDS = 60L
private const val BORDER = 2
