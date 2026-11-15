package com.aarogyam.staff.android.ui.patient

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.android.ui.today.InitialsAvatar
import com.aarogyam.staff.patients.PatientView
import com.aarogyam.staff.patients.Severity
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import java.util.Locale

private enum class FlagTone { Red, Warm, Plain }

private data class PatientFlag(
    val text: String,
    val tone: FlagTone,
)

/** The flags a patient shows: allergies, conditions, recall and the balance. Counts only without `clinical.read`. */
@Composable
private fun flagsFor(view: PatientView): List<PatientFlag> {
    val f = view.flags
    val out = mutableListOf<PatientFlag>()
    if (f.detailsHidden) {
        if (f.allergyCount > 0) {
            out +=
                PatientFlag(
                    stringResource(R.string.pv_flag_allergies, f.allergyCount),
                    if (f.severeAllergy) FlagTone.Red else FlagTone.Warm,
                )
        }
        if (f.conditionCount >
            0
        ) {
            out += PatientFlag(stringResource(R.string.pv_flag_conditions, f.conditionCount), FlagTone.Warm)
        }
    } else {
        f.allergies.forEach {
            out +=
                PatientFlag(it.substance, if (it.severity == Severity.Severe) FlagTone.Red else FlagTone.Warm)
        }
        f.conditions.forEach { out += PatientFlag(it, FlagTone.Warm) }
    }
    if (view.recallDue) out += PatientFlag(stringResource(R.string.pv_flag_recall), FlagTone.Warm)
    view.balancePaise?.takeIf { it > 0 }?.let {
        out +=
            PatientFlag(stringResource(R.string.pv_flag_due, it.rupees()), FlagTone.Plain)
    }
    return out
}

/** `34 y · Female · SD-1042 · English` */
@Composable
private fun lineFor(view: PatientView): String {
    val age = view.ageYears?.let { stringResource(R.string.pv_age_short, it) }
    val sex = view.sex.label()?.let { stringResource(it) }
    val language =
        Locale
            .forLanguageTag(
                view.language,
            ).getDisplayLanguage(LocalConfiguration.current.locales[0])
            .takeIf { it.isNotBlank() }
    return listOfNotNull(age, sex, view.number, language).joinToString(" · ")
}

/** The tonal patient header: initials, name and line, flags, and the four quick actions, then [footer]. */
@Composable
internal fun PatientHeader(
    view: PatientView,
    canBook: Boolean,
    canPhoto: Boolean,
    onBook: () -> Unit,
    onPhoto: () -> Unit,
    footer: @Composable () -> Unit = {},
) {
    val p = SkTheme.palette
    val context = LocalContext.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(
                p.primaryContainer.color,
                RoundedCornerShape(bottomStart = HEADER_RADIUS.dp, bottomEnd = HEADER_RADIUS.dp),
            ).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            InitialsAvatar(view.name, 56.dp, cool = true)
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(view.name, style = v7(20f, FontWeight.ExtraBold), color = p.onPrimaryContainer.color)
                Text(lineFor(view), style = v7(11.5f), color = p.onPrimaryContainer.color.copy(alpha = 0.85f))
            }
        }
        val flags = flagsFor(view)
        if (flags.isNotEmpty()) Flow { flags.forEach { FlagPill(it) } }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val tel = PatientLinks.tel(view.phone)
            val wa = PatientLinks.whatsApp(view.phone)
            QuickAction("phone", stringResource(R.string.pv_action_call), tel != null, Modifier.weight(1f)) {
                tel?.let { view(context, it) }
            }
            QuickAction("wa", stringResource(R.string.pv_action_whatsapp), wa != null, Modifier.weight(1f)) {
                wa?.let { view(context, it) }
            }
            QuickAction("cal", stringResource(R.string.pv_action_book), canBook, Modifier.weight(1f), onBook)
            QuickAction("cam", stringResource(R.string.pv_action_photo), canPhoto, Modifier.weight(1f), onPhoto)
        }
        footer()
    }
}

private const val HEADER_RADIUS = 32

/** Opens [uri] in the dialler or WhatsApp; nothing happens when no app can take it. */
private fun view(
    context: Context,
    uri: String,
) {
    val scheme = if (uri.startsWith("tel:")) Intent.ACTION_DIAL else Intent.ACTION_VIEW
    runCatching { context.startActivity(Intent(scheme, uri.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
private fun FlagPill(flag: PatientFlag) {
    val p = SkTheme.palette
    val (fill, ink) =
        when (flag.tone) {
            FlagTone.Red -> p.errorContainer.color to p.onErrorContainer.color
            FlagTone.Warm -> p.tertiaryContainer.color to p.onTertiaryContainer.color
            FlagTone.Plain -> Color.White.copy(alpha = 0.55f) to p.onPrimaryContainer.color
        }
    Text(
        flag.text,
        style = v7(11.5f, FontWeight.Bold),
        color = ink,
        modifier = Modifier.background(fill, CircleShape).padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

@Composable
private fun QuickAction(
    icon: String,
    title: String,
    enabled: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val p = SkTheme.palette
    Column(
        modifier
            .alpha(if (enabled) 1f else 0.4f)
            .defaultMinSize(minHeight = 44.dp)
            .background(p.background.color, RoundedCornerShape(18.dp))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(vertical = 8.dp)
            .semantics { contentDescription = title },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        V7Icon(icon, p.primary.color, 18.dp)
        Text(title, style = v7(10.5f, FontWeight.Bold), color = p.onSurface.color, maxLines = 1)
    }
}

/** The header's money strip: closed by default ("Tap to show"), then three cells and an eye-off button. */
@Composable
internal fun PatientMoneyStrip(
    model: MoneyStripModel,
    toggle: () -> Unit,
) {
    val p = SkTheme.palette
    val ink = p.onPrimaryContainer.color
    val tint = p.background.color.copy(alpha = 0.55f)
    when (model) {
        MoneyStripModel.None -> {}

        MoneyStripModel.Closed -> {
            val title = stringResource(R.string.p9_money_title)
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 46.dp)
                    .background(tint, CircleShape)
                    .clickable(
                        role = Role.Button,
                        onClickLabel = stringResource(R.string.p9_money_show_hint),
                        onClick = toggle,
                    ).padding(horizontal = 14.dp)
                    .semantics { contentDescription = title },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                V7Icon("eye", ink, 20.dp)
                Text(title, style = v7(13.5f, FontWeight.Bold), color = ink, modifier = Modifier.weight(1f))
                Text(
                    stringResource(R.string.p9_money_tap),
                    style = v7(12f, FontWeight.SemiBold),
                    color = ink.copy(alpha = 0.75f),
                )
            }
        }

        is MoneyStripModel.Open -> {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(
                        tint,
                        RoundedCornerShape(22.dp),
                    ).padding(start = 14.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    MoneyCell(stringResource(R.string.p9_money_visits), model.visits, ink)
                    MoneyCell(stringResource(R.string.p9_money_paid), model.paid, ink)
                    MoneyCell(
                        stringResource(R.string.p9_money_due),
                        model.due,
                        if (model.hasDue) p.tertiary.color else ink,
                    )
                }
                Box(
                    Modifier
                        .size(44.dp)
                        .clickable(role = Role.Button, onClick = toggle)
                        .semantics { contentDescription = "" },
                    contentAlignment = Alignment.Center,
                ) { V7Icon("eye_off", ink, 20.dp) }
            }
        }
    }
}

@Composable
private fun MoneyCell(
    label: String,
    value: String,
    tone: Color,
) {
    Column {
        Text(
            label,
            style = v7(11f, FontWeight.Bold),
            color =
                SkTheme.palette.onPrimaryContainer.color
                    .copy(alpha = 0.8f),
        )
        Text(value, style = v7(16f, FontWeight.ExtraBold), color = tone, maxLines = 1)
    }
}

/** The pill tabs, pinned at the top while the page scrolls; the chosen one is inverted. */
@Composable
internal fun PatientPillTabs(
    tabs: List<PatientPageTab>,
    selection: PatientPageTab,
    historyCount: Int?,
    onSelect: (PatientPageTab) -> Unit,
) {
    val p = SkTheme.palette
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.background.color)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        tabs.forEach { tab ->
            val on = tab == selection
            Box(
                Modifier
                    .defaultMinSize(minHeight = 34.dp)
                    .background((if (on) p.onSurface else p.surface2).color, CircleShape)
                    .clickable(role = Role.Tab) { onSelect(tab) }
                    .semantics { selected = on }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    tabTitle(tab, historyCount),
                    style = v7(12.5f, FontWeight.Bold),
                    color = (if (on) p.background else p.onSurfaceVariant).color,
                )
            }
        }
    }
}

@Composable
private fun tabTitle(
    tab: PatientPageTab,
    historyCount: Int?,
): String =
    when (tab) {
        PatientPageTab.Overview -> {
            stringResource(R.string.p9_tab_overview)
        }

        PatientPageTab.History -> {
            if (historyCount ==
                null
            ) {
                stringResource(R.string.p9_tab_history)
            } else {
                stringResource(R.string.p9_tab_history_n, historyCount)
            }
        }

        PatientPageTab.Consent -> {
            stringResource(R.string.p9_tab_consent)
        }
    }
