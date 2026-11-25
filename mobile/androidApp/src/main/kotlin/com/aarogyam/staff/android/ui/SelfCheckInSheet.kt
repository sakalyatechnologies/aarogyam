package com.aarogyam.staff.android.ui

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.today.qrImage
import com.aarogyam.staff.settings.SelfCheckInHolder
import com.aarogyam.staff.settings.SelfCheckInState
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Self check-in settings (settings.manage): the switch, the patients' QR with Share, and a new key. */
@Composable
fun SelfCheckInSheet(
    holder: SelfCheckInHolder,
    clinicName: String,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    val context = LocalContext.current
    var confirming by remember { mutableStateOf(false) }
    SkModalSheet(stringResource(R.string.selfcheckin_title), onDismiss, subtitle = clinicName) {
        when (val s = state) {
            SelfCheckInState.Loading, SelfCheckInState.NotAllowed -> {}

            is SelfCheckInState.Failed -> {
                Text(stringResource(s.error.message()), style = SkTypography.footnote, color = p.error.color)
                SkPillButton(stringResource(R.string.try_again), holder::load, variant = SkPillVariant.Tonal)
            }

            is SelfCheckInState.Loaded -> {
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
                Text(
                    stringResource(R.string.selfcheckin_message),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                )
                s.error?.let {
                    Text(
                        stringResource(it.message()),
                        style = SkTypography.footnote,
                        color = p.error.color,
                    )
                }
                val url = s.url
                val image = remember(url) { url?.let(::qrImage) }
                if (s.enabled && url != null && image != null) {
                    Image(
                        image,
                        stringResource(R.string.selfcheckin_code),
                        Modifier
                            .size(QR_SIZE.dp)
                            .align(Alignment.CenterHorizontally)
                            .background(Color.White, RoundedCornerShape(QR_RADIUS.dp))
                            .padding(QR_PAD.dp),
                        filterQuality = FilterQuality.None,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SkPillButton(
                            stringResource(R.string.selfcheckin_share),
                            {
                                val send =
                                    Intent(
                                        Intent.ACTION_SEND,
                                    ).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
                                context.startActivity(Intent.createChooser(send, null))
                            },
                            Modifier.weight(1f),
                        )
                        SkPillButton(
                            stringResource(R.string.selfcheckin_new_key),
                            { confirming = true },
                            Modifier.weight(1f),
                            variant = SkPillVariant.Tonal,
                            enabled = !s.saving,
                        )
                    }
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

private const val QR_SIZE = 240
private const val QR_RADIUS = 20
private const val QR_PAD = 16
