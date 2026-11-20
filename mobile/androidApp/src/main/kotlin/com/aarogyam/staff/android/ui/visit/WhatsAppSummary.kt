package com.aarogyam.staff.android.ui.visit

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.visit.MessageSection
import com.aarogyam.staff.visit.MessageTicks
import com.aarogyam.staff.visit.SummaryRefusal
import com.aarogyam.staff.visit.WhatsAppHandoff
import com.aarogyam.staff.visit.WhatsAppSummaryState
import com.aarogyam.staff.visit.WhatsAppSummaryStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkChoiceChips
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

/**
 * "Send on WhatsApp" on the Done screen, or [compact] "Prepare WhatsApp summary" on a finished card of
 * the queue board. Says "prepared", never "sent": we can't see WhatsApp.
 */
@Composable
internal fun WhatsAppSummary(
    clinic: ClinicContext,
    visitId: String,
    compact: Boolean = false,
) {
    val holder = rememberHolder(visitId) { WhatsAppSummaryStateHolder(clinic, visitId, it) }
    if (!holder.visible) return
    val state by holder.state.collectAsStateWithLifecycle()
    val context = LocalContext.current

    val ticks by holder.ticks.collectAsStateWithLifecycle()
    var choosing by rememberSaveable { mutableStateOf(false) }

    fun open(handoff: WhatsAppHandoff) {
        if (openWhatsApp(context, handoff)) holder.handedOff() else holder.whatsAppMissing()
    }

    fun send() {
        if (installedWhatsApp(context) == null) return holder.whatsAppMissing()
        holder.prepare(::open)
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        if (!compact) {
            Text(
                stringResource(R.string.vv_wa_title),
                style = SkTypography.bodyStrong,
                color = SkTheme.colors.text.color,
            )
        }
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
                    onClick = { open(s.handoff) },
                    variant = SkButtonVariant.Secondary,
                    modifier = if (compact) Modifier else Modifier.fillMaxWidth(),
                )
            }

            else -> {
                if (!compact) Muted(stringResource(R.string.vv_wa_hint))
                if (ticks.ticked != null) {
                    when {
                        !compact -> {
                            Ticks(holder, ticks)
                        }

                        choosing -> {
                            Ticks(holder, ticks)
                        }

                        else -> {
                            Text(
                                stringResource(R.string.vv_wa_choose),
                                style = SkTypography.footnote,
                                color = SkTheme.colors.primaryText.color,
                                modifier = Modifier.clickable { choosing = true }.padding(vertical = Spacing.XS.dp),
                            )
                        }
                    }
                }
                val preparing = s == WhatsAppSummaryState.Preparing
                val idle = if (compact) R.string.vv_wa_prepare else R.string.vv_wa_send
                SkButton(
                    stringResource(if (preparing) R.string.vv_wa_preparing else idle),
                    onClick = ::send,
                    variant = SkButtonVariant.Secondary,
                    enabled = !preparing,
                    modifier = if (compact) Modifier else Modifier.fillMaxWidth(),
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

/** The ticks and the live preview, with the stand-in link and PIN greyed out. Saves nothing. */
@Composable
private fun Ticks(
    holder: WhatsAppSummaryStateHolder,
    ticks: MessageTicks,
) {
    LaunchedEffect(holder) { holder.showPreview() }
    val labels = MessageSection.entries.associateWith { stringResource(it.label()) }
    Muted(stringResource(R.string.vv_wa_ticks))
    SkChoiceChips(
        MessageSection.entries,
        MessageSection.entries.filter(ticks::isOn).toSet(),
        { holder.toggle(it, !ticks.isOn(it)) },
        { labels.getValue(it) },
        single = false,
    )
    val parts = ticks.previewParts
    if (parts.isEmpty()) return
    var whole by rememberSaveable { mutableStateOf(false) }
    val muted = SkTheme.colors.textMuted.color
    val text =
        buildAnnotatedString {
            parts.forEach { part ->
                if (part.standIn) withStyle(SpanStyle(color = muted)) { append(part.text) } else append(part.text)
            }
        }
    Column(
        Modifier
            .fillMaxWidth()
            .background(SkTheme.colors.inset.color, RoundedCornerShape(PREVIEW_CORNER.dp))
            .padding(Spacing.SM.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp),
    ) {
        Text(
            text,
            style = SkTypography.footnote,
            color = SkTheme.colors.text.color,
            maxLines = if (whole) Int.MAX_VALUE else PREVIEW_LINES,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            stringResource(if (whole) R.string.vv_wa_preview_less else R.string.vv_wa_preview_more),
            style = SkTypography.footnote,
            color = SkTheme.colors.primaryText.color,
            modifier = Modifier.clickable { whole = !whole },
        )
        Muted(stringResource(R.string.vv_wa_stand_in))
    }
}

@StringRes
private fun MessageSection.label(): Int =
    when (this) {
        MessageSection.Done -> R.string.vv_wa_tick_done
        MessageSection.Detail -> R.string.vv_wa_tick_detail
        MessageSection.Found -> R.string.vv_wa_tick_found
        MessageSection.Plan -> R.string.vv_wa_tick_plan
        MessageSection.Medicines -> R.string.vv_wa_tick_medicines
        MessageSection.Care -> R.string.vv_wa_tick_care
        MessageSection.Offer -> R.string.vv_wa_tick_offer
    }

private const val MINUTES = 60
private const val PREVIEW_LINES = 6
private const val PREVIEW_CORNER = 12
