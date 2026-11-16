package com.aarogyam.staff.android.ui.visit

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.prescriptions.RxSheetState
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.prescriptions.ShareState
import com.aarogyam.staff.prescriptions.ShareView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

private enum class Channel { WhatsApp, Sms, Print }

/** Opens [uri] with the phone's app for it; false when none can. */
internal fun openUri(
    context: Context,
    uri: Uri,
): Boolean =
    runCatching {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }.isSuccess

/** `https://wa.me/<digits>?text=...`; without a number WhatsApp's own chooser opens. */
internal fun whatsAppUri(
    phone: String?,
    text: String,
): Uri = "https://wa.me/${VisitFormat.whatsAppDigits(phone).orEmpty()}?text=${Uri.encode(text)}".toUri()

/** After issuing: the PIN to read out, the delivery chips, "Send now", then the "Sent" result. */
@Composable
internal fun RxDelivery(
    holder: RxSheetStateHolder,
    state: RxSheetState,
    phone: String?,
    onDone: () -> Unit,
) {
    when (val share = state.share) {
        null, ShareState.Creating -> {
            Muted(stringResource(R.string.rx_link_creating))
        }

        is ShareState.Failed -> {
            ErrorLine(stringResource(share.error.message()))
            SkButton(
                stringResource(R.string.rx_share_retry),
                onClick = holder::share,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        is ShareState.Ready -> {
            Chooser(share.link, state.issued?.clinicName.orEmpty(), phone, onDone)
        }
    }
}

@Composable
private fun Chooser(
    link: ShareView,
    clinic: String,
    phone: String?,
    onDone: () -> Unit,
) {
    val colors = SkTheme.colors
    val context = LocalContext.current
    var channel by remember { mutableStateOf(Channel.WhatsApp) }
    var sent by remember { mutableStateOf(false) }
    var cannot by remember { mutableStateOf(false) }
    val message = stringResource(R.string.rx_share_text, clinic, link.url)
    val chooser = stringResource(R.string.rx_share_chooser)
    if (sent) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            Text(stringResource(R.string.vv_c_rx_sent_title), style = SkTypography.title, color = colors.text.color)
            Muted(stringResource(R.string.vv_c_rx_sent_message), Modifier.fillMaxWidth())
            SkButton(stringResource(R.string.done), onClick = onDone, modifier = Modifier.fillMaxWidth())
        }
        return
    }
    Muted(stringResource(R.string.rx_pin_label))
    Text(link.pin, style = SkTypography.largeTitle, color = colors.text.color)
    Muted(stringResource(R.string.rx_pin_note))
    VisitFormat.maskedPhone(phone)?.let { Muted(stringResource(R.string.vv_c_rx_send_to, it)) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        VisitChip(stringResource(R.string.vv_c_rx_send_whatsapp), channel == Channel.WhatsApp) {
            channel =
                Channel.WhatsApp
        }
        VisitChip(stringResource(R.string.vv_c_rx_send_sms), channel == Channel.Sms) { channel = Channel.Sms }
        VisitChip(stringResource(R.string.vv_c_rx_send_print), channel == Channel.Print) { channel = Channel.Print }
    }
    if (channel == Channel.Print) Muted(stringResource(R.string.vv_c_rx_print_preview))
    SkButton(
        stringResource(R.string.vv_c_rx_send_now),
        onClick = {
            val uri =
                when (channel) {
                    Channel.WhatsApp -> {
                        whatsAppUri(phone, message)
                    }

                    Channel.Sms -> {
                        val number = phone.orEmpty().filter { it.isDigit() || it == '+' }
                        "sms:$number?body=${Uri.encode(message)}".toUri()
                    }

                    Channel.Print -> {
                        null
                    }
                }
            if (uri != null) {
                sent = openUri(context, uri)
                cannot = !sent
            }
        },
        enabled = channel != Channel.Print,
        modifier = Modifier.fillMaxWidth(),
    )
    if (cannot) ErrorLine(stringResource(R.string.vv_c_rx_send_cannot))
    SkButton(
        stringResource(R.string.rx_share),
        onClick = {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, message)
            context.startActivity(Intent.createChooser(send, chooser))
        },
        variant = SkButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth(),
    )
    SkButton(
        stringResource(R.string.done),
        onClick = onDone,
        variant = SkButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth(),
    )
}
