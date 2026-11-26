package com.aarogyam.staff.android.ui.patient

import android.content.Intent
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.share.RecordKind
import com.aarogyam.staff.share.RecordSharesStateHolder
import com.aarogyam.staff.share.ShareExpiry
import com.aarogyam.staff.share.ShareLinkState
import com.aarogyam.staff.share.SharePhase
import com.aarogyam.staff.share.ShareRow
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
private fun RecordKind.title(): String =
    stringResource(
        when (this) {
            RecordKind.Chart -> R.string.pv_share_chart
            RecordKind.Xrays -> R.string.pv_share_xrays
            RecordKind.Bills -> R.string.pv_share_bills
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

/**
 * "Share record": pick what to include and how long the link works, then make it (`POST /patients/{id}/record-shares`)
 * and open the system share sheet. The PIN is shown once and is told to the patient apart from the link.
 */
@Composable
internal fun ShareSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember { graph.recordShares(clinic, patientId, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    SkModalSheet(
        stringResource(R.string.pv_share_title),
        onDismiss,
        subtitle = stringResource(R.string.pv_share_message),
    ) {
        val phase = state.phase
        when {
            phase is SharePhase.Ready -> {
                Ready(phase, clinic.session.clinic.name, holder::reset, onDismiss)
            }

            !state.allowed -> {
                V7Muted(stringResource(R.string.pv_share_no_kinds))
            }

            else -> {
                Form(holder, clinic.session.clinic.name)
            }
        }
    }
}

@Composable
private fun Ready(
    ready: SharePhase.Ready,
    clinicName: String,
    onAnother: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    ready.expiresOn?.let { V7Muted(stringResource(R.string.pv_share_expires_on, it.display())) }
    val text = stringResource(R.string.pv_share_text, clinicName) + " " + ready.url
    SkPillButton(
        stringResource(R.string.pv_share_send),
        {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            context.startActivity(Intent.createChooser(send, null))
        },
        wide = true,
    )
    SkPillButton(stringResource(R.string.pv_share_another), onAnother, variant = SkPillVariant.Tonal, wide = true)
    SkPillButton(stringResource(R.string.done), onDismiss, variant = SkPillVariant.Ghost, wide = true)
}

@Composable
private fun Form(
    holder: RecordSharesStateHolder,
    clinicName: String,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    V7Label(stringResource(R.string.pv_share_expires))
    val expiryTitles = ShareExpiry.entries.associateWith { it.title() }
    SkChoiceChips(ShareExpiry.entries, setOf(state.expiry), holder::setExpiry, { expiryTitles.getValue(it) })
    val kindTitles = state.kinds.associateWith { it.title() }
    SkChoiceChips(state.kinds, state.selected, holder::toggle, { kindTitles.getValue(it) }, single = false)
    (state.phase as? SharePhase.Failed)?.let {
        Text(
            stringResource(R.string.pv_share_failed),
            style = v7(12.5f, FontWeight.SemiBold),
            color = SkTheme.palette.error.color,
        )
    }
    SkPillButton(
        stringResource(R.string.pv_share_create),
        holder::create,
        wide = true,
        loading = state.phase == SharePhase.Creating,
        enabled = state.selected.isNotEmpty(),
    )
    V7Label(stringResource(R.string.pv_share_active))
    state.linksError?.let { V7Muted(stringResource(it.message())) }
    if (state.links.isEmpty() && state.linksError == null) V7Muted(stringResource(R.string.pv_share_none))
    // TODO(BK-9): Revoke on each usable link, once the API has a revoke route for record shares.
    state.links.forEach { LinkRow(it) }
}

@Composable
private fun LinkRow(link: ShareRow) {
    val titles = RecordKind.entries.associateWith { it.title() }
    val kinds = link.kinds.joinToString(" · ") { titles.getValue(it) }
    val status =
        when (link.state) {
            ShareLinkState.Usable -> stringResource(R.string.pv_share_usable, link.expiresOn?.display().orEmpty())
            ShareLinkState.Expired -> stringResource(R.string.pv_share_expired)
            ShareLinkState.Locked -> stringResource(R.string.pv_share_locked)
        }
    Text(kinds, style = v7(13.5f, FontWeight.SemiBold), color = SkTheme.palette.onSurface.color)
    V7Muted(status + " · " + stringResource(R.string.pv_share_opened, link.openCount))
}
