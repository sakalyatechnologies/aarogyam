package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.glass.GroupGap
import com.aarogyam.staff.android.ui.glass.GroupHeader
import com.aarogyam.staff.android.ui.glass.KindTile
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.desk.DeskLookupState
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.FamilyStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * The front desk's lookup (the iOS DeskSheet): a mobile field with live results, the profiles on the number, and the
 * next actions. The number is on screen only; nothing here logs it.
 */
@Composable
fun DeskLookupScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: DeskLookupStateHolder,
    onClose: () -> Unit,
    onNewPatient: (String, List<DeskFamilyAnchor>) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val online by graph.connectivity.online.collectAsStateWithLifecycle()
    var typed by rememberSaveable { mutableStateOf("") }
    var paying by remember { mutableStateOf<DeskPayTarget?>(null) }
    var relatives by remember { mutableStateOf<DeskPayTarget?>(null) }
    val change = { text: String ->
        typed = DeskPhone.format(text)
        holder.search(DeskPhone.query(typed))
    }
    val scroll = rememberScrollState()
    val collapsed by remember { derivedStateOf { scroll.value > 0 } }
    Column(Modifier.fillMaxSize().imePadding()) {
        // Clear Glass chrome: a calm title bar that turns tonal once the content scrolls under it.
        SkCollapsingTopBar(
            title = stringResource(R.string.dk_d9_lookup_title),
            collapsed = collapsed,
            kicker = stringResource(R.string.dk_d9_lookup_subtitle),
            actions = { SkPillButton(stringResource(R.string.dk_d9_done), onClose, variant = SkPillVariant.Tonal) },
        )
        Column(
            Modifier.weight(1f).verticalScroll(scroll).padding(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            val done = state as? DeskLookupState.CheckedIn
            if (done != null) {
                CheckedInCard(done.tokenNumber, onAnother = { change("") }, onDone = onClose)
            } else {
                if (!online) DeskNotice(stringResource(R.string.dk_d9_lookup_offline))
                DeskNumberField(typed, change, stringResource(R.string.dk_d9_lookup_mobile), autoFocus = true)
                DeskLookupStatus(holder, state, typed) { onNewPatient(it, emptyList()) }
                (state as? DeskLookupState.Matches)?.let { found ->
                    LookupMatches(clinic, holder, found, { paying = it }, { relatives = it }, onNewPatient)
                }
            }
        }
    }
    paying?.let { DeskPaymentSheet(graph, clinic, it, refreshTick = 0) { paying = null } }
    relatives?.let { target ->
        val scope = rememberCoroutineScope()
        val family = remember(target.patientId) { FamilyStateHolder(clinic, target.patientId, scope) }
        DeskFamilySheet(family, target.name, target.patientId) { relatives = null }
    }
}

@Composable
private fun LookupMatches(
    clinic: ClinicContext,
    holder: DeskLookupStateHolder,
    found: DeskLookupState.Matches,
    onPay: (DeskPayTarget) -> Unit,
    onFamily: (DeskPayTarget) -> Unit,
    onNewPatient: (String, List<DeskFamilyAnchor>) -> Unit,
) {
    val canCollect = "billing.write" in clinic.permissions && "billing.read" in clinic.permissions
    val canFamily = "patients.read" in clinic.permissions && ServerCaps.family
    val anchors = found.profiles.filter { it.familyOf == null }.map { DeskFamilyAnchor(it.id, it.name) }
    Column(verticalArrangement = Arrangement.spacedBy(GroupGap)) {
        GroupHeader(stringResource(R.string.dk_d9_lookup_profiles, found.profiles.size))
        found.profiles.forEachIndexed { i, profile ->
            DeskProfileRow(
                profile = profile,
                ofName = found.profiles.firstOrNull { it.id == profile.familyOf }?.name,
                canCollect = canCollect,
                canFamily = canFamily,
                onCheckIn = { holder.checkIn(profile.id) },
                onCollect = { onPay(DeskPayTarget(profile.id, profile.name)) },
                onFamily = { onFamily(DeskPayTarget(profile.id, profile.name)) },
                index = i,
                count = found.profiles.size,
            )
        }
    }
    // Someone new on this number, as the last group: one tap each, as before.
    val count = if (ServerCaps.family && !found.partial) 2 else 1
    Column(verticalArrangement = Arrangement.spacedBy(GroupGap)) {
        DeskActionRow("plus", stringResource(R.string.dk_d9_lookup_new), 0, count) {
            onNewPatient(DeskPhone.newPatientPhone(found.phone), emptyList())
        }
        if (ServerCaps.family && !found.partial) {
            DeskActionRow("family", stringResource(R.string.dk_d9_lookup_family), 1, count) {
                onNewPatient(found.phone, anchors)
            }
        }
    }
}

@Composable
private fun CheckedInCard(
    token: Int,
    onAnother: () -> Unit,
    onDone: () -> Unit,
) {
    val p = SkTheme.palette
    Row(
        Modifier.fillMaxWidth().background(p.card.color, RoundedCornerShape(DONE_RADIUS.dp)).padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindTile("check", SkTone.Success, DONE_TILE.dp)
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.dk_d9_lookup_done_title, token),
                style = SkTypography.headline,
                color = p.onSurface.color,
            )
            DeskMutedText(stringResource(R.string.dk_d9_lookup_done_message))
        }
    }
    SkButton(
        stringResource(R.string.dk_d9_lookup_another),
        onClick = onAnother,
        variant = SkButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth(),
    )
    SkButton(stringResource(R.string.dk_d9_done), onClick = onDone, modifier = Modifier.fillMaxWidth())
}

private const val DONE_RADIUS = 20
private const val DONE_TILE = 48
