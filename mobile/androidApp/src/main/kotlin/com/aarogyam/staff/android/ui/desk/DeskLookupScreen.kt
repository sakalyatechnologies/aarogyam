package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.desk.DeskLookupState
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.FamilyStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
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
        holder.search(DeskPhone.digits(typed))
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        SkTopBar(
            title = stringResource(R.string.dk_d9_lookup_title),
            subtitle = stringResource(R.string.dk_d9_lookup_subtitle),
            actions = { BarAction(stringResource(R.string.dk_d9_done), SkTheme.colors.onBrandDark.color, onClose) },
        )
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(Spacing.ML.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            val done = state as? DeskLookupState.CheckedIn
            if (done != null) {
                CheckedInCard(done.tokenNumber, onAnother = { change("") }, onDone = onClose)
            } else {
                if (!online) DeskNotice(stringResource(R.string.dk_d9_lookup_offline))
                DeskNumberField(typed, change, stringResource(R.string.dk_d9_lookup_mobile))
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
    DeskLabel(stringResource(R.string.dk_d9_lookup_profiles, found.profiles.size))
    found.profiles.forEach { profile ->
        DeskProfileRow(
            profile = profile,
            ofName = found.profiles.firstOrNull { it.id == profile.familyOf }?.name,
            canCollect = canCollect,
            canFamily = canFamily,
            onCheckIn = { holder.checkIn(profile.id) },
            onCollect = { onPay(DeskPayTarget(profile.id, profile.name)) },
            onFamily = { onFamily(DeskPayTarget(profile.id, profile.name)) },
        )
    }
    if (ServerCaps.family) {
        SkButton(
            stringResource(R.string.dk_d9_lookup_family),
            onClick = { onNewPatient(found.phone, anchors) },
            variant = SkButtonVariant.Secondary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    SkButton(
        stringResource(R.string.dk_d9_lookup_new),
        onClick = { onNewPatient(found.phone, emptyList()) },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun CheckedInCard(
    token: Int,
    onAnother: () -> Unit,
    onDone: () -> Unit,
) {
    DeskLabel(stringResource(R.string.dk_d9_lookup_done_title, token))
    DeskMutedText(stringResource(R.string.dk_d9_lookup_done_message))
    SkButton(
        stringResource(R.string.dk_d9_lookup_another),
        onClick = onAnother,
        variant = SkButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth(),
    )
    SkButton(stringResource(R.string.dk_d9_done), onClick = onDone, modifier = Modifier.fillMaxWidth())
}
