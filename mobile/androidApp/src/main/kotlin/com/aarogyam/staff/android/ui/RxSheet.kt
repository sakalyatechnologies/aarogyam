package com.aarogyam.staff.android.ui

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.prescriptions.AllergyWarning
import com.aarogyam.staff.prescriptions.DrugView
import com.aarogyam.staff.prescriptions.RxLine
import com.aarogyam.staff.prescriptions.RxPhase
import com.aarogyam.staff.prescriptions.RxPresets
import com.aarogyam.staff.prescriptions.RxSheetState
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.prescriptions.ShareState
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Writes and issues a prescription; once issued the same sheet turns into the share sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RxSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    allergies: List<AllergyView>,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember { graph.rxSheet(clinic, patientId, allergies, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    val title = if (state.phase == RxPhase.Issued) R.string.rx_issued_title else R.string.rx_sheet_title
    SkBottomSheet(title = stringResource(title), subtitle = state.issued?.number, onDismiss = onDismiss) {
        Column(Modifier.heightIn(max = SHEET_MAX_HEIGHT.dp).verticalScroll(rememberScrollState())) {
            when {
                !state.allowed -> Muted(stringResource(R.string.rx_sheet_not_allowed))
                state.phase == RxPhase.Issued -> SharePanel(holder, state, onDismiss)
                else -> Composing(holder, state)
            }
        }
    }
}

@Composable
private fun Composing(
    holder: RxSheetStateHolder,
    state: RxSheetState,
) {
    val locked = state.phase == RxPhase.Issuing
    SkSearchField(
        query = state.query,
        onQueryChange = holder::search,
        placeholder = stringResource(R.string.rx_search),
        modifier = Modifier.padding(vertical = Spacing.M.dp),
    )
    state.results.forEach { drug -> DrugRow(drug) { holder.add(drug) } }
    if (state.lines.isEmpty() && state.results.isEmpty()) {
        SkButton(
            stringResource(R.string.rx_quick),
            onClick = holder::quickRx,
            variant = SkButtonVariant.Secondary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    state.lines.forEach { line -> LineCard(holder, line, editable = !locked) }
    Warnings(holder, state)
    state.error?.let { RxError(stringResource(it.message())) }
    SkButton(
        stringResource(if (locked) R.string.rx_issuing else R.string.rx_issue),
        onClick = holder::issue,
        enabled = state.canIssue,
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp, bottom = Spacing.L.dp),
    )
}

@Composable
private fun DrugRow(
    drug: DrugView,
    onAdd: () -> Unit,
) {
    SkListRow(
        title = drug.name,
        subtitle = listOfNotNull(drug.brand, drug.strength, drug.form).joinToString(" · "),
        onClick = onAdd,
    )
    SkDivider()
}

@Composable
private fun LineCard(
    holder: RxSheetStateHolder,
    line: RxLine,
    editable: Boolean,
) {
    SkCard(modifier = Modifier.padding(top = Spacing.M.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(line.name, style = SkTypography.headline, color = SkTheme.colors.text.color)
                if (line.detail.isNotBlank()) Muted(line.detail)
            }
            if (editable) {
                BarAction(
                    stringResource(R.string.rx_remove_short),
                    SkTheme.colors.dangerText.color,
                    { holder.remove(line.key) },
                    description = stringResource(R.string.rx_remove, line.name),
                )
            }
        }
        PresetRow(R.string.rx_dose, RxPresets.doses, line.dose, { it }, editable) { holder.setDose(line.key, it) }
        PresetRow(R.string.rx_frequency, RxPresets.frequencies, line.frequency, {
            it
        }, editable) { holder.setFrequency(line.key, it) }
        PresetRow(R.string.rx_duration, RxPresets.durations, line.durationDays, { daysText(it) }, editable) {
            holder.setDuration(line.key, it)
        }
    }
}

@Composable
private fun <T> PresetRow(
    label: Int,
    options: List<T>,
    selected: T,
    text: @Composable (T) -> String,
    enabled: Boolean,
    onPick: (T) -> Unit,
) {
    Text(
        stringResource(label),
        style = SkTypography.footnote,
        color = SkTheme.colors.textMuted.color,
        modifier = Modifier.padding(top = Spacing.M.dp),
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        val shown = if (selected in options) options else listOf(selected) + options
        shown.forEach { option ->
            Box(
                Modifier
                    .sizeIn(minHeight = Spacing.MIN_TOUCH_TARGET.dp)
                    .clickable(enabled = enabled, role = Role.RadioButton) { onPick(option) },
                contentAlignment = Alignment.Center,
            ) {
                SkChip(text(option), tone = if (option == selected) SkTone.Brand else SkTone.Neutral)
            }
        }
    }
}

@Composable
private fun Warnings(
    holder: RxSheetStateHolder,
    state: RxSheetState,
) {
    if (!state.needsOverride) return
    SkCard(modifier = Modifier.padding(top = Spacing.M.dp)) {
        state.warnings.forEach { RxError(it.text()) }
        state.serverAlerts.forEach { RxError(it.message) }
        if (state.serverAlert && state.serverAlerts.isEmpty()) RxError(stringResource(R.string.rx_server_alert))
        SkTextField(
            value = state.overrideReason,
            onValueChange = holder::setOverrideReason,
            label = stringResource(R.string.rx_override_label),
            supportingText = stringResource(R.string.rx_override_help),
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.M.dp),
        )
    }
}

@Composable
private fun AllergyWarning.text(): String =
    stringResource(R.string.rx_allergy_warning, drug, substance, stringResource(severity.label()))

@Composable
private fun SharePanel(
    holder: RxSheetStateHolder,
    state: RxSheetState,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    when (val share = state.share) {
        null, ShareState.Creating -> {
            Muted(stringResource(R.string.rx_link_creating))
            LoadingIndicatorInline()
        }

        is ShareState.Failed -> {
            RxError(stringResource(share.error.message()))
            SkButton(
                stringResource(R.string.rx_share_retry),
                onClick = holder::share,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        is ShareState.Ready -> {
            Muted(stringResource(R.string.rx_pin_label))
            Text(
                share.link.pin,
                style = SkTypography.largeTitle,
                color = SkTheme.colors.text.color,
                modifier = Modifier.padding(vertical = Spacing.S.dp),
            )
            Muted(stringResource(R.string.rx_pin_note))
            share.link.expiresAt?.let { Muted(stringResource(R.string.rx_link_expires, it.date.display())) }
            // The text names only the clinic and the link; the PIN is told aloud, never sent with it.
            val text = stringResource(R.string.rx_share_text, state.issued?.clinicName.orEmpty(), share.link.url)
            val chooser = stringResource(R.string.rx_share_chooser)
            SkButton(
                stringResource(R.string.rx_share),
                onClick = {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                    context.startActivity(Intent.createChooser(send, chooser))
                },
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp),
            )
        }
    }
    SkButton(
        stringResource(R.string.done),
        onClick = onDone,
        variant = SkButtonVariant.Secondary,
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.M.dp),
    )
}

@Composable
private fun LoadingIndicatorInline() =
    Box(Modifier.fillMaxWidth().padding(Spacing.L.dp), contentAlignment = Alignment.Center) {
        androidx.compose.material3.CircularProgressIndicator(color = SkTheme.colors.primary.color)
    }

@Composable
private fun Muted(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)

@Composable
private fun RxError(text: String) =
    Text(
        text,
        style = SkTypography.footnote,
        color = SkTheme.colors.dangerText.color,
        modifier = Modifier.padding(top = Spacing.S.dp),
    )

private const val SHEET_MAX_HEIGHT = 640
