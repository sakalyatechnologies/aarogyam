package com.aarogyam.staff.android.ui.live

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.live.LiveBanner
import com.aarogyam.staff.live.LiveBannerHolder
import com.sakalya.mobile.design.ReducedMotion
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * The app-wide banner for a patient waiting, send in and collect payment (iOS `LiveBannerView`). It shows over any
 * screen for 6 seconds (the holder hides it), a tap dismisses it and calls [onOpen], TalkBack is told, and with reduced
 * motion it fades instead of sliding. Takes no space and no touches while nothing shows.
 */
@Composable
fun LiveBannerOverlay(
    clinic: ClinicContext,
    onOpen: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember(clinic.slug) { LiveBannerHolder(clinic, scope) }
    val banner by holder.banner.collectAsStateWithLifecycle()
    var shown by remember { mutableStateOf<LiveBanner?>(null) }
    val haptic = LocalHapticFeedback.current
    val sentIn = stringResource(R.string.sh_lv10_dismiss)
    LaunchedEffect(banner?.notificationId) {
        shown = banner
        val now = banner ?: return@LaunchedEffect
        if (LiveLogic.line(now.kind, now.tokenNumber) == null) return@LaunchedEffect
        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        if (now.kind == "send_in") {
            runCatching {
                ToneGenerator(
                    AudioManager.STREAM_NOTIFICATION,
                    TONE_VOLUME,
                ).startTone(ToneGenerator.TONE_PROP_ACK)
            }
        }
    }
    val reduced = SkTheme.reducedMotion == ReducedMotion.On
    Box(Modifier.fillMaxSize().statusBarsPadding(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = shown != null && banner != null,
            enter = if (reduced) fadeIn() else slideInVertically { -it } + fadeIn(),
            exit = if (reduced) fadeOut() else slideOutVertically { -it } + fadeOut(),
        ) {
            val current = shown
            val line = current?.let { LiveLogic.line(it.kind, it.tokenNumber) }
            if (current != null && line != null) {
                val text =
                    if (line.usesToken) {
                        stringResource(
                            line.res,
                            current.tokenNumber ?: 0,
                        )
                    } else {
                        stringResource(line.res)
                    }
                val p = SkTheme.palette
                Text(
                    text,
                    style = SkTypography.bodyStrong,
                    color = p.onPrimaryContainer.color,
                    modifier =
                        Modifier
                            .padding(horizontal = Spacing.L.dp, vertical = Spacing.S.dp)
                            .fillMaxWidth()
                            .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                            .background(p.primaryContainer.color, RoundedCornerShape(BANNER_RADIUS.dp))
                            .clickable(onClickLabel = sentIn, role = Role.Button) {
                                holder.dismiss()
                                onOpen()
                            }.semantics { liveRegion = LiveRegionMode.Polite }
                            .padding(Spacing.M.dp),
                )
            }
        }
    }
}

private const val TONE_VOLUME = 60
private const val BANNER_RADIUS = 14
