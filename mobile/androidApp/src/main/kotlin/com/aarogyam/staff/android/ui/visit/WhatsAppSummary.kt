package com.aarogyam.staff.android.ui.visit

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.visit.SummaryRefusal
import com.aarogyam.staff.visit.WhatsAppHandoff
import com.aarogyam.staff.visit.WhatsAppSummaryState
import com.aarogyam.staff.visit.WhatsAppSummaryStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalTime

/** WhatsApp Business first (a clinic phone), then WhatsApp. */
private val WHATSAPP_PACKAGES = listOf("com.whatsapp.w4b", "com.whatsapp")

private fun installedWhatsApp(context: Context): String? =
    WHATSAPP_PACKAGES.firstOrNull { context.packageManager.getLaunchIntentForPackage(it) != null }

/** Opens the chat with the text filled in; false when no WhatsApp could take it. */
private fun openWhatsApp(
    context: Context,
    handoff: WhatsAppHandoff,
): Boolean {
    val app = installedWhatsApp(context) ?: return false
    // wa.me pinned to the package resolves inside the device: no web hop, so the full text is fine.
    val intent = Intent(Intent.ACTION_VIEW, handoff.waMeLink.toUri()).setPackage(app)
    return try {
        context.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

@StringRes
private fun SummaryRefusal.message(): Int =
    when (this) {
        SummaryRefusal.VisitOpen -> R.string.vv_wa_visit_open
        SummaryRefusal.NoPhone -> R.string.vv_wa_no_phone
        SummaryRefusal.NoConsent -> R.string.vv_wa_no_consent
        SummaryRefusal.OptedOut -> R.string.vv_wa_opted_out
        SummaryRefusal.NoWhatsApp -> R.string.vv_wa_no_whatsapp
    }

private fun clock(minute: Int): String = LocalTime(minute / MINUTES, minute % MINUTES).display()

/** "Send on WhatsApp" on the Done screen. Says "prepared", never "sent": we can't see WhatsApp. */
@Composable
internal fun WhatsAppSummary(
    clinic: ClinicContext,
    visitId: String,
) {
    val holder = rememberHolder { WhatsAppSummaryStateHolder(clinic, visitId, it) }
    if (!holder.visible) return
    val state by holder.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    fun send() {
        if (installedWhatsApp(context) == null) return holder.whatsAppMissing()
        holder.prepare { if (!openWhatsApp(context, it)) holder.whatsAppMissing() }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        Text(stringResource(R.string.vv_wa_title), style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
        when (val s = state) {
            is WhatsAppSummaryState.Prepared -> {
                val line =
                    stringResource(
                        if (s.forGuardian) R.string.vv_wa_prepared_guardian else R.string.vv_wa_prepared,
                        clock(s.preparedMinute),
                    )
                val auto = s.autoSentMinute?.let { stringResource(R.string.vv_wa_auto, clock(it)) }
                Muted(
                    listOfNotNull(line, auto).joinToString(" "),
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                SkButton(
                    stringResource(R.string.vv_wa_again),
                    onClick = { if (!openWhatsApp(context, s.handoff)) holder.whatsAppMissing() },
                    variant = SkButtonVariant.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            else -> {
                Muted(stringResource(R.string.vv_wa_hint))
                val preparing = s == WhatsAppSummaryState.Preparing
                SkButton(
                    stringResource(if (preparing) R.string.vv_wa_preparing else R.string.vv_wa_send),
                    onClick = ::send,
                    variant = SkButtonVariant.Secondary,
                    enabled = !preparing,
                    modifier = Modifier.fillMaxWidth(),
                )
                val problem =
                    when (s) {
                        is WhatsAppSummaryState.Refused -> s.reason.message()
                        is WhatsAppSummaryState.Failed -> s.error.message()
                        else -> null
                    }
                problem?.let {
                    ErrorLine(
                        stringResource(it),
                        Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
        }
    }
}

private const val MINUTES = 60
