package com.aarogyam.staff.android.ui.labs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ChoiceChips
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.clinical.DatePickDialog
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.labs.LabRow
import com.aarogyam.staff.labs.LabWork
import com.aarogyam.staff.labs.NewLabCaseState
import com.aarogyam.staff.labs.NewLabCaseStateHolder
import com.aarogyam.staff.patients.PatientRow
import com.aarogyam.staff.patients.PatientsState
import com.aarogyam.staff.patients.PatientsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** "New lab case": choose the patient, then the lab, the work, a due date and instructions. */
@Composable
fun NewLabCaseFlow(
    graph: AppGraph,
    clinic: ClinicContext,
    labs: List<LabRow>,
    onCreated: () -> Unit,
    onDismiss: () -> Unit,
) {
    var patient by remember { mutableStateOf<PatientRow?>(null) }
    val scope = rememberCoroutineScope()
    val picked = patient
    SkBottomSheet(
        title = stringResource(R.string.cn_pv_newlab_title),
        subtitle = picked?.name ?: stringResource(R.string.cn_pv_newlab_pick),
        onDismiss = onDismiss,
    ) {
        if (picked == null) {
            val holder = remember { graph.patients(clinic, scope) }
            PatientPicker(holder, onPick = { patient = it })
        } else {
            val holder = remember(picked.id) { graph.newLabCase(clinic, picked.id, null, scope) }
            NewLabCaseForm(holder, labs, onDone = {
                onCreated()
                onDismiss()
            })
        }
    }
}

@Composable
private fun PatientPicker(
    holder: PatientsStateHolder,
    onPick: (PatientRow) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }
    Column(Modifier.padding(horizontal = Spacing.L.dp), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        SkSearchField(text, {
            text = it
            holder.search(it)
        }, stringResource(R.string.cn_pv_patients_search))
        (state as? PatientsState.Loaded)?.items?.take(PICK_LIMIT)?.forEach { row ->
            SkListRow(row.name, subtitle = row.number, onClick = { onPick(row) })
        }
    }
}

@Composable
private fun NewLabCaseForm(
    holder: NewLabCaseStateHolder,
    labs: List<LabRow>,
    onDone: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    Column(
        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
    ) {
        val number = state.created
        if (number != null) {
            Text(
                stringResource(R.string.cn_pv_newlab_created, number),
                style = SkTypography.headline,
                color = SkTheme.colors.text.color,
            )
            SkButton(stringResource(R.string.done), onDone, Modifier.fillMaxWidth())
        } else {
            LabChoice(holder, state, labs)
            WorkSection(holder, state)
            DueSection(holder, state)
            SkTextField(
                state.instructions,
                holder::setInstructions,
                stringResource(R.string.cn_pv_newlab_instructions),
                singleLine = false,
            )
            state.error?.let {
                Text(
                    stringResource(it.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                SkButton(stringResource(R.string.cn_pv_newlab_draft), {
                    holder.save(false)
                }, Modifier.weight(1f), SkButtonVariant.Secondary, enabled = state.canSave)
                SkButton(stringResource(R.string.cn_pv_newlab_send), {
                    holder.save(true)
                }, Modifier.weight(1f), enabled = state.canSave)
            }
        }
    }
}

@Composable
private fun LabChoice(
    holder: NewLabCaseStateHolder,
    state: NewLabCaseState,
    labs: List<LabRow>,
) {
    SectionLabel(stringResource(R.string.cn_pv_newlab_lab))
    ChoiceChips(labs, { it.id == state.labId }, { it.name }, { holder.chooseLab(it.id, null) })
    val lab = labs.firstOrNull { it.id == state.labId } ?: return
    val line = lab.infoLine()
    if (line.isNotEmpty()) Text(line, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)
    if (lab.contacts.isNotEmpty()) {
        ChoiceChips(lab.contacts, {
            it.id == state.contactId
        }, { it.name }, { holder.chooseLab(lab.id, it.id) })
    }
}

@Composable
private fun WorkSection(
    holder: NewLabCaseStateHolder,
    state: NewLabCaseState,
) {
    val colors = SkTheme.colors
    var workType by remember { mutableStateOf("") }
    var teeth by remember { mutableStateOf("") }
    var shade by remember { mutableStateOf("") }
    var material by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf(1) }
    SectionLabel(stringResource(R.string.cn_pv_newlab_work))
    state.work.forEachIndexed { index, item ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${item.workType} × ${item.qty}", style = SkTypography.bodyStrong, color = colors.text.color)
                val detail =
                    ClinicalFormat.joinDot(
                        listOf(
                            item.teeth.takeIf { it.isNotEmpty() }?.let {
                                stringResource(
                                    R.string.cn_pv_lab_teeth,
                                    it.joinToString(", "),
                                )
                            },
                            item.shade,
                            item.material,
                        ),
                    )
                if (detail.isNotEmpty()) Text(detail, style = SkTypography.footnote, color = colors.textMuted.color)
            }
            SkButton(stringResource(R.string.cn_pv_newlab_remove), {
                holder.removeWork(index)
            }, variant = SkButtonVariant.Secondary)
        }
    }
    SkTextField(workType, { workType = it }, stringResource(R.string.cn_pv_newlab_work_type))
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        SkTextField(
            teeth,
            {
                teeth = it
            },
            stringResource(
                R.string.cn_pv_newlab_teeth,
            ),
            Modifier.weight(1f),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        SkTextField(shade, { shade = it }, stringResource(R.string.cn_pv_newlab_shade), Modifier.weight(1f))
    }
    SkTextField(material, { material = it }, stringResource(R.string.cn_pv_form_material))
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(stringResource(R.string.cn_pv_newlab_qty, qty), style = SkTypography.label, color = colors.text.color)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton("−", { qty = (qty - 1).coerceAtLeast(1) }, variant = SkButtonVariant.Secondary)
            SkButton("+", { qty = (qty + 1).coerceAtMost(MAX_QTY) }, variant = SkButtonVariant.Secondary)
        }
    }
    SkButton(stringResource(R.string.cn_pv_newlab_add_work), {
        holder.addWork(LabWork(workType, parseTeeth(teeth), shade, material, qty))
        workType = ""
        teeth = ""
        shade = ""
        material = ""
        qty = 1
    }, Modifier.fillMaxWidth(), SkButtonVariant.Secondary, enabled = workType.isNotBlank())
}

@Composable
private fun DueSection(
    holder: NewLabCaseStateHolder,
    state: NewLabCaseState,
) {
    var picking by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(stringResource(R.string.cn_pv_newlab_due), style = SkTypography.label, color = SkTheme.colors.text.color)
        Switch(checked = state.dueOn != null, onCheckedChange = { on ->
            if (on) picking = true else holder.setDue(null)
        })
    }
    state.dueOn?.let { Text(ClinicalFormat.date(it), style = SkTypography.bodyText, color = SkTheme.colors.text.color) }
    if (picking) DatePickDialog(onPicked = holder::setDue, onDismiss = { picking = false })
}

/** Tooth numbers from "46, 47" or "46 47": FDI numbers 11 to 85, duplicates kept out. */
fun parseTeeth(text: String): List<Int> =
    text
        .split(Regex("[^0-9]+"))
        .mapNotNull { it.toIntOrNull() }
        .filter { it in FDI_MIN..FDI_MAX }
        .distinct()

private const val FDI_MIN = 11
private const val FDI_MAX = 85
private const val MAX_QTY = 20
private const val PICK_LIMIT = 20
