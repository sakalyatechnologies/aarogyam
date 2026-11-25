package com.aarogyam.staff.android.ui.desk

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.today.qrImage
import com.aarogyam.staff.desk.DueBill
import com.aarogyam.staff.desk.UpiLinkHolder
import com.aarogyam.staff.desk.UpiLinkState
import com.aarogyam.staff.desk.UpiShare
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant

/**
 * "Send UPI link" for [due] (BK-13): fetches the link, opens the share sheet with its text and
 * shows the QR beneath so the patient can scan it at the desk.
 */
@Composable
fun UpiLinkSection(
    holder: UpiLinkHolder,
    due: DueBill,
) {
    if (!holder.canSend(due)) return
    val state by holder.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val share: (UpiShare) -> Unit = { link ->
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, link.text)
            }
        context.startActivity(Intent.createChooser(send, null))
    }
    val ready = state as? UpiLinkState.Ready
    LaunchedEffect(ready?.share) { ready?.let { share(it.share) } }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SkPillButton(
            stringResource(R.string.dk_dx_upi_send),
            { holder.send(due.id) },
            Modifier.fillMaxWidth(),
            variant = SkPillVariant.Tonal,
            enabled = state != UpiLinkState.Loading,
        )
        if (state is UpiLinkState.Failed) DeskErrorText(stringResource(R.string.dk_dx_upi_failed))
        if (ready != null) {
            val image = remember(ready.share.qrData) { qrImage(ready.share.qrData) }
            if (image != null) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(
                        image,
                        stringResource(R.string.dk_dx_upi_qr),
                        Modifier
                            .size(200.dp)
                            .background(Color.White, RoundedCornerShape(16.dp))
                            .padding(12.dp),
                    )
                }
            }
            SkPillButton(
                stringResource(R.string.dk_dx_upi_share_again),
                { share(ready.share) },
                Modifier.fillMaxWidth(),
                variant = SkPillVariant.Tonal,
            )
        }
    }
}
