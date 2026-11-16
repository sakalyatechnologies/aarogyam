package com.aarogyam.staff.android.ui.today

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/** The clinic's public booking page for the origin, or null when there is no origin (iOS `TodayV7.bookingURL`). */
fun bookingUrl(origin: String): String? = origin.trim(' ', '/').takeIf { it.isNotEmpty() }?.let { "$it/book" }

/** A black-on-white QR code for [text], one pixel per module plus a quiet zone; null when it cannot be encoded. */
@android.annotation.SuppressLint("UseKtx")
fun qrImage(text: String): ImageBitmap? =
    runCatching {
        val matrix =
            QRCodeWriter().encode(
                text,
                BarcodeFormat.QR_CODE,
                0,
                0,
                mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 1),
            )
        val bitmap =
            android.graphics.Bitmap.createBitmap(
                matrix.width,
                matrix.height,
                android.graphics.Bitmap.Config.ARGB_8888,
            )
        for (x in 0 until matrix.width) {
            for (y in 0 until matrix.height) {
                bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            }
        }
        bitmap.asImageBitmap()
    }.getOrNull()

/** "Clinic QR": the clinic's public booking page as a code patients scan, with the link beneath. */
@Composable
fun ClinicQrSheet(
    url: String?,
    clinicName: String,
    onDismiss: () -> Unit,
) {
    val p = SkTheme.palette
    val image = remember(url) { url?.let(::qrImage) }
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    SkModalSheet(stringResource(R.string.sh_t7_qr_title), onDismiss, subtitle = clinicName) {
        if (url != null && image != null) {
            val description = stringResource(R.string.sh_t7_qr_code)
            Image(
                image,
                description,
                Modifier
                    .size(QR_SIZE.dp)
                    .align(Alignment.CenterHorizontally)
                    .background(Color.White, RoundedCornerShape(QR_RADIUS.dp))
                    .padding(QR_PAD.dp),
                filterQuality = androidx.compose.ui.graphics.FilterQuality.None,
            )
            Text(
                stringResource(R.string.sh_t7_qr_message),
                style = SkTypography.bodyText,
                color = p.onSurfaceVariant.color,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                url,
                style = SkTypography.caption,
                color = p.onSurface.color,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                horizontalArrangement =
                    androidx.compose.foundation.layout.Arrangement
                        .spacedBy(8.dp),
            ) {
                SkPillButton(
                    stringResource(if (copied) R.string.sh_t7_qr_copied else R.string.sh_t7_qr_copy),
                    {
                        scope.launch {
                            clipboard.setClipEntry(
                                androidx.compose.ui.platform
                                    .ClipEntry(ClipData.newPlainText("", url)),
                            )
                        }
                        copied = true
                    },
                    Modifier.weight(1f),
                    variant = SkPillVariant.Tonal,
                )
                SkPillButton(
                    stringResource(R.string.sh_t7_qr_share),
                    {
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url)
                        context.startActivity(Intent.createChooser(send, null))
                    },
                    Modifier.weight(1f),
                )
            }
        } else {
            Text(
                stringResource(R.string.sh_t7_qr_unavailable),
                style = SkTypography.footnote,
                color = p.onSurfaceVariant.color,
            )
        }
    }
}

private const val QR_SIZE = 240
private const val QR_RADIUS = 20
private const val QR_PAD = 16
