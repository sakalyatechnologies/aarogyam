package com.aarogyam.staff.android.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.today.bookingUrl
import com.aarogyam.staff.android.ui.today.qrImage
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.settings.PatientQr
import com.aarogyam.staff.settings.PatientQrTab
import com.aarogyam.staff.settings.SelfCheckInHolder
import com.aarogyam.staff.settings.SelfCheckInState
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/**
 * "Patient QR": one sheet for the two codes patients scan. Check in is the self check-in code (shown when
 * [PatientQr.canShowCheckInQr]); Book appointment is the clinic's public booking page. One allowed tab shows alone.
 */
@Composable
fun PatientQrSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    start: PatientQrTab,
    onDismiss: () -> Unit,
) {
    val tabs = remember(clinic.permissions) { PatientQr.tabs(clinic.permissions) }
    var tab by rememberSaveable { mutableStateOf(PatientQr.initial(clinic.permissions, start)) }
    val name = clinic.session.clinic.name
    SkModalSheet(stringResource(R.string.pqr_title), onDismiss, subtitle = name) {
        if (tabs.size > 1) {
            val labels = tabs.map { stringResource(it.label()) }
            SkSegmented(labels, tabs.indexOf(tab).coerceAtLeast(0), { tab = tabs[it] }, Modifier.fillMaxWidth())
        }
        when (tab) {
            PatientQrTab.CheckIn -> {
                val holder = rememberHolder { graph.selfCheckIn(clinic, it) }
                CheckInTab(holder, name, PatientQr.canManageCheckInQr(clinic.permissions))
            }

            PatientQrTab.Book -> {
                BookTab(bookingUrl(clinic.api.origin), name)
            }
        }
    }
}

private fun PatientQrTab.label(): Int =
    when (this) {
        PatientQrTab.CheckIn -> R.string.pqr_tab_checkin
        PatientQrTab.Book -> R.string.pqr_tab_book
    }

@Composable
private fun ColumnScope.About(text: Int) {
    Text(stringResource(text), style = SkTypography.footnote, color = SkTheme.palette.onSurfaceVariant.color)
}

@Composable
private fun ColumnScope.QrTile(
    image: androidx.compose.ui.graphics.ImageBitmap,
    description: String,
) {
    Image(
        image,
        description,
        Modifier
            .size(QR_SIZE.dp)
            .align(Alignment.CenterHorizontally)
            .background(Color.White, RoundedCornerShape(QR_RADIUS.dp))
            .padding(QR_PAD.dp),
        filterQuality = FilterQuality.None,
    )
}

private fun share(
    context: Context,
    url: String,
) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
    context.startActivity(Intent.createChooser(send, null))
}

@Composable
private fun ColumnScope.PosterButton(
    url: String,
    clinicName: String,
    caption: Int,
) {
    val context = LocalContext.current
    val text = stringResource(caption)
    SkPillButton(
        stringResource(R.string.pqr_print),
        { printPoster(context, url, clinicName, text) },
        Modifier.fillMaxWidth(),
        variant = SkPillVariant.Tonal,
    )
}

/** Check in: the self check-in code. The switch and "Make a new QR" are for settings.manage only. */
@Composable
private fun ColumnScope.CheckInTab(
    holder: SelfCheckInHolder,
    clinicName: String,
    canManage: Boolean,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    val context = LocalContext.current
    var confirming by remember { mutableStateOf(false) }
    About(R.string.pqr_checkin_about)
    when (val s = state) {
        SelfCheckInState.Loading, SelfCheckInState.NotAllowed -> {}

        is SelfCheckInState.Failed -> {
            Text(stringResource(s.error.message()), style = SkTypography.footnote, color = p.error.color)
            SkPillButton(stringResource(R.string.try_again), holder::load, variant = SkPillVariant.Tonal)
        }

        is SelfCheckInState.Loaded -> {
            if (canManage) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        stringResource(R.string.selfcheckin_switch),
                        Modifier.weight(1f),
                        style = SkTypography.bodyStrong,
                        color = p.onSurface.color,
                    )
                    Switch(
                        s.enabled,
                        holder::setEnabled,
                        enabled = !s.saving,
                        colors = SwitchDefaults.colors(checkedTrackColor = p.primary.color),
                    )
                }
            }
            s.error?.let {
                Text(stringResource(it.message()), style = SkTypography.footnote, color = p.error.color)
            }
            val url = s.url
            val image = remember(url) { url?.let(::qrImage) }
            if (s.enabled && url != null && image != null) {
                QrTile(image, stringResource(R.string.selfcheckin_code))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SkPillButton(
                        stringResource(R.string.selfcheckin_share),
                        { share(context, url) },
                        Modifier.weight(1f),
                    )
                    if (canManage) {
                        SkPillButton(
                            stringResource(R.string.selfcheckin_new_key),
                            { confirming = true },
                            Modifier.weight(1f),
                            variant = SkPillVariant.Tonal,
                            enabled = !s.saving,
                        )
                    }
                }
                PosterButton(url, clinicName, R.string.pqr_poster_checkin)
            } else if (!s.enabled) {
                Text(
                    stringResource(R.string.selfcheckin_off),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.selfcheckin_new_key_title)) },
            text = { Text(stringResource(R.string.selfcheckin_new_key_body)) },
            confirmButton = {
                TextButton({
                    confirming = false
                    holder.regenerateKey()
                }) { Text(stringResource(R.string.selfcheckin_new_key), color = p.error.color) }
            },
            dismissButton = {
                TextButton(
                    { confirming = false },
                ) { Text(stringResource(R.string.selfcheckin_cancel)) }
            },
        )
    }
}

/** Book appointment: the clinic's public booking page, with the link, Copy and Share. */
@Composable
private fun ColumnScope.BookTab(
    url: String?,
    clinicName: String,
) {
    val p = SkTheme.palette
    val image = remember(url) { url?.let(::qrImage) }
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    About(R.string.pqr_book_about)
    if (url != null && image != null) {
        QrTile(image, stringResource(R.string.sh_t7_qr_code))
        Text(
            url,
            style = SkTypography.caption,
            color = p.onSurface.color,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkPillButton(
                stringResource(if (copied) R.string.sh_t7_qr_copied else R.string.sh_t7_qr_copy),
                {
                    scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("", url))) }
                    copied = true
                },
                Modifier.weight(1f),
                variant = SkPillVariant.Tonal,
            )
            SkPillButton(stringResource(R.string.sh_t7_qr_share), { share(context, url) }, Modifier.weight(1f))
        }
        PosterButton(url, clinicName, R.string.pqr_poster_book)
    } else {
        Text(
            stringResource(R.string.sh_t7_qr_unavailable),
            style = SkTypography.footnote,
            color = p.onSurfaceVariant.color,
        )
    }
}

private const val QR_SIZE = 240
private const val QR_RADIUS = 20
private const val QR_PAD = 16
