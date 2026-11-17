package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.ProcedureFindings
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.TermKind
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.chart.TreatmentBlock
import com.aarogyam.staff.chart.TreatmentCheck
import com.aarogyam.staff.chart.TreatmentFormState
import com.aarogyam.staff.chart.TreatmentStatus
import com.aarogyam.staff.chart.matchTerms
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
private fun TreatmentStatus.title(): String =
    stringResource(
        when (this) {
            TreatmentStatus.Completed -> R.string.pv_status_completed
            TreatmentStatus.Planned -> R.string.pv_status_planned
            TreatmentStatus.Watch -> R.string.pv_status_watch
        },
    )

@Composable
private fun TreatmentBlock.message(): String =
    stringResource(
        when (this) {
            TreatmentBlock.NoTreatment -> R.string.pv_block_no_treatment
            TreatmentBlock.NeedsVisit -> R.string.pv_block_needs_visit
            TreatmentBlock.NoChartMark -> R.string.pv_block_no_chart_mark
        },
    )

@Composable
private fun TermView.text(): String = if (own) stringResource(R.string.pv_form_own, label) else label

/** The one-letter surface chips of the mockup. */
private fun Surface.letter(): String = name

/**
 * The Add treatment form: treatment chips, surfaces, a material dropdown (with "Add new"), the
 * Completed, Planned or Watch status, a note and Save. Why Save cannot be pressed shows beside it.
 */
@Composable
internal fun AddTreatmentForm(
    holder: ChartStateHolder,
    chart: ChartState.Loaded,
    sheet: ToothSheetStateHolder,
    form: TreatmentFormState,
    tooth: ToothView,
    onBack: () -> Unit,
) {
    val p = SkTheme.palette
    var newMaterial by remember { mutableStateOf("") }
    var addingMaterial by remember { mutableStateOf(false) }
    val procedures = remember(chart.terms) { matchTerms(chart.terms, TermKind.Procedure, "") }
    val materials = remember(chart.terms) { matchTerms(chart.terms, TermKind.Material, "") }
    val wholeTooth = form.treatment?.let { ProcedureFindings.of(it)?.wholeTooth } ?: false
    val added = chart.addedTerm
    LaunchedEffect(added?.id) {
        if (added != null) {
            if (added.kind == TermKind.Material) sheet.chooseMaterial(added) else sheet.chooseTreatment(added)
            holder.consumeAddedTerm()
            addingMaterial = false
            newMaterial = ""
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val back = stringResource(R.string.pv_form_back)
        Row(
            Modifier
                .defaultMinSize(
                    minHeight = 44.dp,
                ).clickable(role = Role.Button, onClickLabel = back, onClick = onBack),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            V7Icon("back", p.primary.color, 16.dp)
            Text(
                stringResource(if (form.editing == null) R.string.pv_form_title else R.string.pv_form_edit),
                style = v7(14f, FontWeight.ExtraBold),
                color = p.onSurface.color,
            )
        }
        V7Label(stringResource(R.string.pv_form_treatment))
        val texts = procedures.associateWith { it.text() }
        SkChoiceChips(
            options = procedures,
            selected = setOfNotNull(form.treatment),
            onToggle = { sheet.chooseTreatment(if (it == form.treatment) null else it) },
            label = { texts.getValue(it) },
        )
        V7Label(stringResource(R.string.pv_form_surfaces))
        Row(Modifier.alpha(if (wholeTooth) 0.4f else 1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Surface.entries.forEach { surface ->
                SkChoiceChip(
                    surface.letter(),
                    surface in form.surfaces,
                    { if (!wholeTooth) sheet.toggleSurface(surface) },
                    single = false,
                )
            }
        }
        if (wholeTooth) V7Muted(stringResource(R.string.pv_form_whole))
        V7Label(stringResource(R.string.pv_form_material))
        MaterialMenu(form.material, materials, sheet) { addingMaterial = true }
        if (addingMaterial) {
            AddMaterial(chart, newMaterial, { newMaterial = it }, holder) {
                addingMaterial = false
                newMaterial = ""
                holder.consumeAddedTerm()
            }
        }
        V7Label(stringResource(R.string.pv_form_status))
        SkSegmented(
            TreatmentStatus.entries.map { it.title() },
            form.status.ordinal,
            { sheet.setStatus(TreatmentStatus.entries[it]) },
        )
        SkField(stringResource(R.string.pv_form_note), form.note, sheet::setNote)
        Footer(chart, sheet, form, tooth)
    }
}

/** A field-shaped menu: the chosen material, "None", the clinic's list, and "Add new". */
@Composable
private fun MaterialMenu(
    chosen: TermView?,
    materials: List<TermView>,
    sheet: ToothSheetStateHolder,
    onAdd: () -> Unit,
) {
    val p = SkTheme.palette
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 46.dp)
                .background(p.surface3.color, RoundedCornerShape(14.dp))
                .clickable(role = Role.DropdownList) { open = true }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                chosen?.label ?: stringResource(R.string.pv_form_choose),
                style = v7(15f),
                color = (if (chosen == null) p.onSurfaceVariant else p.onSurface).color,
                modifier = Modifier.weight(1f),
            )
            V7Icon("chev", p.onSurfaceVariant.color, 16.dp)
        }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem({ Text(stringResource(R.string.pv_form_none)) }, {
                sheet.chooseMaterial(null)
                open = false
            })
            materials.forEach { term ->
                DropdownMenuItem({ Text(term.text()) }, {
                    sheet.chooseMaterial(term)
                    open = false
                })
            }
            DropdownMenuItem({ Text(stringResource(R.string.pv_form_add_new)) }, {
                onAdd()
                open = false
            })
        }
    }
}

@Composable
private fun AddMaterial(
    chart: ChartState.Loaded,
    text: String,
    onText: (String) -> Unit,
    holder: ChartStateHolder,
    onCancel: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SkField(stringResource(R.string.pv_form_new_material), text, onText)
        chart.termError?.let {
            Text(
                stringResource(R.string.pv_form_term_failed, stringResource(it.message())),
                style = v7(12.5f),
                color = SkTheme.palette.error.color,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkPillButton(
                stringResource(R.string.pv_form_add),
                { holder.addTerm(TermKind.Material, text) },
                variant = SkPillVariant.Tonal,
                loading = chart.addingTerm,
                enabled = text.isNotBlank(),
            )
            SkPillButton(stringResource(R.string.p9_cancel), onCancel, variant = SkPillVariant.Ghost)
        }
    }
}

@Composable
private fun Footer(
    chart: ChartState.Loaded,
    sheet: ToothSheetStateHolder,
    form: TreatmentFormState,
    tooth: ToothView,
) {
    val p = SkTheme.palette
    (form.check as? TreatmentCheck.Blocked)?.let { blocked ->
        Row(
            Modifier.fillMaxWidth().background(p.tertiaryContainer.color, RoundedCornerShape(14.dp)).padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            V7Icon("spark", p.onTertiaryContainer.color, 16.dp)
            Text(blocked.reason.message(), style = v7(12.5f, FontWeight.SemiBold), color = p.onTertiaryContainer.color)
        }
    }
    form.error?.let {
        Text(
            stringResource(it.message()),
            style = v7(12.5f, FontWeight.SemiBold),
            color = p.error.color,
        )
    }
    SkPillButton(
        stringResource(R.string.pv_form_save),
        { sheet.save(tooth.number) },
        modifier = Modifier.padding(top = 4.dp),
        wide = true,
        loading = form.saving,
        enabled = form.check is TreatmentCheck.Ok && !chart.saving,
    )
}
