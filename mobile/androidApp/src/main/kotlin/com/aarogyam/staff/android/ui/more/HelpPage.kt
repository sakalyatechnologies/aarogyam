package com.aarogyam.staff.android.ui.more

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Where support is reached; the iOS app reads the same two values from its Info.plist. */
object SupportContact {
    const val EMAIL = "support@aarogyam.example"
    const val WHATSAPP = ""

    fun emailUri(subject: String): Uri = "mailto:$EMAIL?subject=${Uri.encode(subject)}".toUri()

    /** `https://wa.me/<digits>?text=...`; null when no number is set. */
    fun whatsAppUri(text: String): Uri? {
        val digits = WHATSAPP.filter(Char::isDigit)
        return if (digits.isEmpty()) null else "https://wa.me/$digits?text=${Uri.encode(text)}".toUri()
    }
}

/** Help and feedback: email and WhatsApp support are real links; chatting inside the app waits for server support. */
@Composable
fun HelpPage(onBack: () -> Unit) {
    val p = SkTheme.palette
    val context = LocalContext.current
    val open = { uri: Uri? ->
        uri?.let { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, it)) } }
        Unit
    }
    val subject = stringResource(R.string.sh_c_help_email_subject)
    val text = stringResource(R.string.sh_c_help_whatsapp_text)
    Column(Modifier.fillMaxSize()) {
        SkCollapsingTopBar(
            stringResource(R.string.sh_c_help_title),
            collapsed = false,
            navigation = { BarAction(stringResource(R.string.back), p.primary.color, onBack) },
        )
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.L.dp),
        ) {
            Text(
                stringResource(R.string.sh_c_help_message),
                style = SkTypography.footnote,
                color = p.onSurfaceVariant.color,
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                HelpRow(
                    "msg",
                    stringResource(R.string.sh_c_help_email),
                    SupportContact.EMAIL,
                    first = true,
                    last = false,
                ) {
                    open(SupportContact.emailUri(subject))
                }
                HelpRow(
                    "wa",
                    stringResource(R.string.sh_c_help_whatsapp),
                    stringResource(R.string.sh_c_help_whatsapp_sub),
                    first = false,
                    last = false,
                ) {
                    open(SupportContact.whatsAppUri(text))
                }
                HelpRow(
                    "help",
                    stringResource(R.string.sh_c_help_chat),
                    stringResource(R.string.sh_c_help_chat_sub),
                    first = false,
                    last = true,
                    preview = true,
                ) {
                }
            }
            Text(
                stringResource(R.string.sh_c_help_chat_preview),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
        }
    }
}

@Composable
private fun HelpRow(
    icon: String,
    title: String,
    sub: String,
    first: Boolean,
    last: Boolean,
    preview: Boolean = false,
    onClick: () -> Unit,
) {
    val p = SkTheme.palette
    val top = if (first) BIG else SMALL
    val bottom = if (last) BIG else SMALL
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.surface1.color, RoundedCornerShape(top.dp, top.dp, bottom.dp, bottom.dp))
            .clickable(enabled = !preview, role = Role.Button, onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SkIcon(Icons.of(icon), p.onSurfaceVariant.color, size = 19.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = SkTypography.bodyStrong, color = p.onSurface.color)
            if (sub.isNotEmpty()) Text(sub, style = SkTypography.caption, color = p.onSurfaceVariant.color)
        }
        if (preview) {
            SkChip(stringResource(R.string.sh_c_preview_chip), tone = SkTone.Warning)
        } else {
            SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = 18.dp)
        }
    }
}

private const val BIG = 22
private const val SMALL = 8
