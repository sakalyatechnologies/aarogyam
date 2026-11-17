package com.aarogyam.staff.android.ui.visit

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.today.InitialsAvatar
import com.aarogyam.staff.patients.Patient360State
import com.aarogyam.staff.patients.PatientView
import com.aarogyam.staff.visit.VisitView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** "Saved, will send · N": shows while writes saved on this phone wait for the network. */
@Composable
internal fun OutboxBadge(graph: AppGraph) {
    val pending by graph.outbox.pending.collectAsStateWithLifecycle()
    if (pending <= 0) return
    val colors = SkTheme.colors
    Text(
        stringResource(R.string.vv_outbox_badge, pending),
        style = SkTypography.label,
        color = colors.warningText.color,
        modifier =
            Modifier
                .clip(RoundedCornerShape(CAPSULE.dp))
                .background(colors.warningSoft.color)
                .padding(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
    )
}

/** Whether the phone has a network, for the offline banner. */
@Composable
internal fun rememberOnline(): Boolean {
    val context = LocalContext.current
    var online by remember { mutableStateOf(true) }
    DisposableEffect(context) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        online = manager?.activeNetwork != null
        val callback =
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    online = true
                }

                override fun onLost(network: Network) {
                    online = manager?.activeNetwork != null
                }
            }
        manager?.registerDefaultNetworkCallback(callback)
        onDispose { runCatching { manager?.unregisterNetworkCallback(callback) } }
    }
    return online
}

@Composable
internal fun OfflineBanner() {
    val colors = SkTheme.colors
    Text(
        stringResource(R.string.vv_v9v_offline),
        style = SkTypography.callout,
        color = colors.warningText.color,
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Spacing.L.dp))
                .background(colors.warningSoft.color)
                .padding(Spacing.ML.dp),
    )
}

/** The top of the visit: live pill, patient, big timer and the allergy banners. */
@Composable
internal fun VisitHeader(
    graph: AppGraph,
    view: VisitView,
    patient: Patient360State,
    chair: Int?,
) {
    val colors = SkTheme.colors
    val ink = colors.onBrandDark.color
    val person = (patient as? Patient360State.Loaded)?.view
    StatusBarTone.DarkHeader()
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                colors.brandDark.color,
                RoundedCornerShape(bottomStart = HEAD_RADIUS.dp, bottomEnd = HEAD_RADIUS.dp),
            ).statusBarsPadding()
            .padding(horizontal = Spacing.L.dp, vertical = Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!view.closed) {
                Text(
                    chair?.let { stringResource(R.string.vv_v9v_live_chair, it) }
                        ?: stringResource(R.string.vv_c_visit_in_treatment),
                    style = SkTypography.label,
                    color = ink,
                    modifier =
                        Modifier
                            .clip(
                                RoundedCornerShape(CAPSULE.dp),
                            ).background(
                                ink.copy(alpha = PILL_ALPHA),
                            ).padding(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
                )
            }
            OutboxBadge(graph)
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            InitialsAvatar(person?.name ?: "?", AVATAR.dp, cool = true)
            Column {
                Text(person?.name.orEmpty(), style = SkTypography.headline, color = ink, maxLines = 2)
                Text(
                    subtitle(person, view),
                    style = SkTypography.footnote,
                    color = ink.copy(alpha = SUB_ALPHA),
                    maxLines = 2,
                )
            }
        }
        if (view.closed) {
            Text(
                stringResource(R.string.vv_v9v_closed_title),
                style = SkTypography.title,
                color = ink,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        } else {
            VisitTimer(view, ink)
        }
        person?.flags?.allergies?.forEach { allergy ->
            val severity = stringResource(allergy.severity.label())
            val spoken = stringResource(R.string.vv_v9v_allergy_a11y, allergy.substance, severity)
            Text(
                stringResource(R.string.vv_v9v_allergy_banner, allergy.substance, severity),
                style = SkTypography.bodyStrong,
                color = colors.dangerText.color,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(Spacing.L.dp))
                        .background(colors.dangerSoft.color)
                        .padding(horizontal = Spacing.ML.dp, vertical = Spacing.SM.dp)
                        .semantics { contentDescription = spoken },
            )
        }
    }
}

@Composable
private fun subtitle(
    person: PatientView?,
    view: VisitView,
): String {
    val parts = mutableListOf<String>()
    if (person != null) {
        parts += person.number
        person.ageYears?.let { parts += stringResource(R.string.age_years, it) }
        person.sex.label()?.let { parts += stringResource(it) }
    }
    parts += view.number
    return parts.joinToString(" · ")
}

/** The running time since the visit started, ticking every second, with when it started. */
@Composable
private fun VisitTimer(
    view: VisitView,
    ink: androidx.compose.ui.graphics.Color,
) {
    val started = view.startedAt?.epochSeconds
    val now by produceState(System.currentTimeMillis() / MILLIS, started) {
        while (true) {
            value = System.currentTimeMillis() / MILLIS
            delay(MILLIS)
        }
    }
    val seconds = if (started == null) 0L else now - started
    val description = stringResource(R.string.vv_c_visit_timer_a11y, seconds / MINUTE)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            VisitFormat.timer(seconds),
            color = ink,
            fontSize = TIMER.sp,
            fontWeight = FontWeight.ExtraBold,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            modifier = Modifier.semantics { contentDescription = description },
        )
        if (started != null) {
            val time =
                DateTimeFormatter
                    .ofLocalizedTime(
                        FormatStyle.SHORT,
                    ).withZone(ZoneId.systemDefault())
                    .format(Instant.ofEpochSecond(started))
            Text(
                stringResource(R.string.vv_v9v_started, time),
                style = SkTypography.footnote,
                color = ink.copy(alpha = SUB_ALPHA),
            )
        }
    }
}

private const val CAPSULE = 999
private const val HEAD_RADIUS = 28
private const val AVATAR = 46
private const val TIMER = 52
private const val PILL_ALPHA = 0.2f
private const val SUB_ALPHA = 0.85f
private const val MILLIS = 1000L
private const val MINUTE = 60L
