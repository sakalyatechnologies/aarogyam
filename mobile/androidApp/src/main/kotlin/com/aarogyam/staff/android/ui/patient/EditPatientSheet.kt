package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.walkin.AddressSection
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.PatientEditProblem
import com.aarogyam.staff.patients.PatientView
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
private fun PatientEditProblem.message(): String =
    stringResource(
        when (this) {
            PatientEditProblem.NameRequired -> R.string.pv_edit_name_required
            PatientEditProblem.BirthDateInvalid -> R.string.pv_edit_birth_invalid
            PatientEditProblem.AgeInvalid -> R.string.pv_edit_age_invalid
            PatientEditProblem.Changed -> R.string.pv_edit_changed
        },
    )

/**
 * "Edit details": name, mobile number, sex, date of birth (or age) and the optional address
 * (`PATCH /patients/{id}`). A saved edit reloads the page through [onSaved].
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun EditPatientSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    view: PatientView,
    onSaved: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember(view.id) { graph.patientEdit(clinic, view, scope) }
    val form by holder.state.collectAsStateWithLifecycle()
    var intakeOpen by remember { mutableStateOf(false) }
    LaunchedEffect(form.saved) {
        if (form.saved) {
            onSaved()
            onDismiss()
        }
    }
    SkModalSheet(stringResource(R.string.pv_edit_title), onDismiss, subtitle = view.number) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            SkTextField(
                value = form.name,
                onValueChange = holder::setName,
                label = stringResource(R.string.walk_in_name),
            )
            if (form.canEditPhone) {
                SkTextField(
                    value = form.phone,
                    onValueChange = holder::setPhone,
                    label = stringResource(R.string.pv_edit_phone),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                )
            } else {
                V7Muted(stringResource(R.string.pv_edit_phone_locked))
            }
            V7Label(stringResource(R.string.walk_in_sex))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
                listOf(Sex.Female, Sex.Male, Sex.Other).forEach { sex ->
                    val text = sex.label()?.let { stringResource(it) } ?: return@forEach
                    PickChip(text, selected = form.sex == sex, onClick = { holder.setSex(sex) })
                }
            }
            SkTextField(
                value = form.birthDate,
                onValueChange = holder::setBirthDate,
                label = stringResource(R.string.pv_edit_birth),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            if (form.birthDate.isEmpty()) {
                SkTextField(
                    value = form.age,
                    onValueChange = holder::setAge,
                    label = stringResource(R.string.walk_in_age),
                    supportingText = stringResource(R.string.pv_edit_age_hint),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            V7Label(stringResource(R.string.address_title))
            AddressSection(form.address, holder::setAddress)
            if ("patients.write" in clinic.permissions) {
                SkPillButton(
                    stringResource(R.string.dk_iv_edit_open),
                    { intakeOpen = true },
                    Modifier.fillMaxWidth(),
                    variant = SkPillVariant.Tonal,
                )
            }
            form.problem?.let { Text(it.message(), style = v7(13f), color = SkTheme.palette.error.color) }
            form.error?.let { Text(stringResource(it.message()), style = v7(13f), color = SkTheme.palette.error.color) }
            SkPillButton(
                stringResource(R.string.pv_edit_save),
                holder::save,
                Modifier.fillMaxWidth(),
                enabled = !form.saving,
            )
        }
    }
    if (intakeOpen) {
        IntakeEditSheet(graph, clinic, view.id, view.sex == Sex.Female) { intakeOpen = false }
    }
}
