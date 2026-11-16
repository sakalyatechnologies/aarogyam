package com.aarogyam.staff.android.ui.patient

import android.content.Intent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.prescriptions.RxListState
import com.aarogyam.staff.prescriptions.RxStatus
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** The record kinds the share sheet offers; only the prescription has a link on the server yet. */
private enum class ShareKind(
    val real: Boolean,
) {
    Chart(false),
    Rx(true),
    Xrays(false),
    Bills(false),
}

/** The expiry chips; the server's link lasts seven days whatever is chosen. */
private enum class ShareExpiry(
    val real: Boolean,
) {
    Hour(false),
    Day(false),
    Week(true),
}

private sealed interface SharePhase {
    data object Idle : SharePhase

    data object Creating : SharePhase

    data object Failed : SharePhase

    data class Ready(
        val url: String,
        val pin: String,
        val expires: String?,
    ) : SharePhase
}

@Composable
private fun ShareKind.title(): String =
    stringResource(
        when (this) {
            ShareKind.Chart -> R.string.pv_share_chart
            ShareKind.Rx -> R.string.pv_share_rx
            ShareKind.Xrays -> R.string.pv_share_xrays
            ShareKind.Bills -> R.string.pv_share_bills
        },
    )

@Composable
private fun ShareExpiry.title(): String =
    stringResource(
        when (this) {
            ShareExpiry.Hour -> R.string.pv_share_hour
            ShareExpiry.Day -> R.string.pv_share_day
            ShareExpiry.Week -> R.string.pv_share_week
        },
    )

/** "Share record": an expiring link with a PIN. The prescription link is real; chart, X-rays and bills are Preview. */
@Composable
internal fun ShareSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val list = remember { graph.rxList(clinic, patientId, scope) }
    val state by list.state.collectAsStateWithLifecycle()
    var kinds by remember { mutableStateOf(setOf(ShareKind.Chart, ShareKind.Rx)) }
    var expiry by remember { mutableStateOf(ShareExpiry.Week) }
    var phase by remember { mutableStateOf<SharePhase>(SharePhase.Idle) }
    val loaded = state as? RxListState.Loaded
    val target = loaded?.items?.firstOrNull { it.status == RxStatus.Issued }
    val p = SkTheme.palette
    val clinicName = clinic.session.clinic.name
    SkModalSheet(
        stringResource(R.string.pv_share_title),
        onDismiss,
        subtitle = stringResource(R.string.pv_share_message),
    ) {
        val ready = phase as? SharePhase.Ready
        if (ready != null) {
            V7Label(stringResource(R.string.pv_share_pin))
            Text(
                ready.pin,
                style = v7(34f, FontWeight.ExtraBold).copy(fontFamily = FontFamily.Monospace, letterSpacing = 4.sp),
                color = p.onSurface.color,
            )
            V7Muted(stringResource(R.string.pv_share_pin_note))
            ready.expires?.let { V7Muted(stringResource(R.string.pv_share_expires_on, it)) }
            val text = stringResource(R.string.pv_share_text, clinicName) + " " + ready.url
            SkPillButton(
                stringResource(R.string.pv_share_send),
                {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    context.startActivity(Intent.createChooser(send, null))
                },
                wide = true,
            )
            SkPillButton(stringResource(R.string.done), onDismiss, variant = SkPillVariant.Ghost, wide = true)
        } else {
            V7Label(stringResource(R.string.pv_share_expires))
            val expiryTitles = ShareExpiry.entries.associateWith { it.title() }
            SkChoiceChips(ShareExpiry.entries, setOf(expiry), { expiry = it }, { expiryTitles.getValue(it) })
            val kindTitles = ShareKind.entries.associateWith { it.title() }
            SkChoiceChips(
                ShareKind.entries,
                kinds,
                { kinds = if (it in kinds) kinds - it else kinds + it },
                { kindTitles.getValue(it) },
                single = false,
            )
            if (!expiry.real || kinds.any { !it.real }) V7Pill(stringResource(R.string.pv_share_preview), PillKind.Warm)
            if (target == null && loaded != null) V7Muted(stringResource(R.string.pv_share_no_rx))
            if (phase == SharePhase.Failed) {
                Text(
                    stringResource(R.string.pv_share_failed),
                    style = v7(12.5f, FontWeight.SemiBold),
                    color = p.error.color,
                )
            }
            SkPillButton(
                stringResource(R.string.pv_share_create),
                {
                    val id = target?.id ?: return@SkPillButton
                    phase = SharePhase.Creating
                    scope.launch { phase = create(clinic, id) }
                },
                wide = true,
                loading = phase == SharePhase.Creating,
                enabled = target != null && ShareKind.Rx in kinds,
            )
        }
    }
}

/** Creates the patient's link for one issued prescription (`POST /prescriptions/{id}/share`). */
private suspend fun create(
    clinic: ClinicContext,
    id: String,
): SharePhase =
    when (val result = clinic.api.sharePrescription(id)) {
        is Outcome.Success -> {
            val link = result.value
            val expires =
                runCatching {
                    Instant
                        .parse(
                            link.expiresAt,
                        ).toLocalDateTime(TimeZone.of(clinic.session.clinic.timezone))
                        .date
                        .display()
                }.getOrNull()
            SharePhase.Ready(clinic.api.origin + "/shared/" + link.token, link.pin, expires)
        }

        is Outcome.Failure -> {
            SharePhase.Failed
        }
    }
