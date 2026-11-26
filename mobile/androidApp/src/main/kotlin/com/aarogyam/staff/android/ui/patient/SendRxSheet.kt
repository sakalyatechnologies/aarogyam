package com.aarogyam.staff.android.ui.patient

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.prescriptions.ShareState
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** "Send prescription": a fresh link and PIN for the visit's signed Rx, then the phone's share sheet (WhatsApp, SMS). */
@Composable
internal fun SendRxSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    visitId: String,
    rx: VisitRxRef,
    onDone: () -> Unit,
) {
    val holder = rememberHolder { graph.rxSheet(clinic, patientId, emptyList(), it, visitId) }
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(rx.id) { holder.shareIssued(rx.id, rx.number) }
    val context = LocalContext.current
    SkModalSheet(stringResource(R.string.p9_visit_rx_send), onDismiss = onDone, subtitle = rx.number) {
        when (val share = state.share) {
            null, ShareState.Creating -> {
                V7Muted(stringResource(R.string.rx_link_creating))
            }

            is ShareState.Failed -> {
                Text(stringResource(share.error.message()), style = v7(12.5f), color = SkTheme.palette.error.color)
                SkPillButton(stringResource(R.string.rx_share_retry), holder::share, wide = true)
            }

            is ShareState.Ready -> {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    share.link.expiresAt?.let { V7Muted(stringResource(R.string.rx_link_expires, it.date.display())) }
                }
                // The text names only the clinic and the link.
                val text = stringResource(R.string.rx_share_text, state.issued?.clinicName.orEmpty(), share.link.url)
                val chooser = stringResource(R.string.rx_share_chooser)
                SkPillButton(
                    stringResource(R.string.rx_share),
                    {
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                        context.startActivity(Intent.createChooser(send, chooser))
                    },
                    wide = true,
                )
            }
        }
        SkPillButton(stringResource(R.string.done), onDone, variant = SkPillVariant.Ghost, wide = true)
    }
}
