package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.desk.DeskWrap
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.api.model.CheckInChoice
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.walkin.DetailField
import com.aarogyam.staff.walkin.IntakeEditHolder
import com.aarogyam.staff.walkin.IntakeEditState
import com.aarogyam.staff.walkin.IntakeField
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * "Case-paper details" of an existing patient (`GET` and `PUT /patients/{id}/intake`). A phone the server masked
 * (no patients.contact) shows as it came, read-only, and goes back unchanged.
 */
@Composable
internal fun IntakeEditSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    female: Boolean,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember(patientId) { graph.intakeEdit(clinic, patientId, female, scope) }
    val state by holder.state.collectAsState()
    SkModalSheet(stringResource(R.string.dk_iv_edit_title), onDismiss) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            when (val s = state) {
                IntakeEditState.Loading -> V7Muted(stringResource(R.string.loading))
                IntakeEditState.NotAllowed -> V7Muted(stringResource(R.string.dk_iv_edit_not_allowed))
                is IntakeEditState.Failed -> V7Muted(stringResource(s.error.message()))
                is IntakeEditState.Editing -> EditFields(holder, s)
            }
        }
    }
}

@Composable
private fun EditFields(
    holder: IntakeEditHolder,
    e: IntakeEditState.Editing,
) {
    val d = e.details
    V7Label(stringResource(R.string.dk_iv_sec_personal))
    Picks(e.options?.bloodGroups.orEmpty(), d.bloodGroup, R.string.dk_iv_blood) {
        holder.setDetail(DetailField.BloodGroup, it)
    }
    Field(holder, DetailField.Occupation, R.string.dk_iv_occupation, d.occupation)
    V7Label(stringResource(R.string.dk_iv_sec_contact))
    Phone(holder, e, DetailField.AltPhone, R.string.dk_iv_alt_phone, d.altPhone, IntakeField.AltPhone)
    Field(holder, DetailField.EmergencyName, R.string.dk_iv_emergency_name, d.emergencyName)
    Phone(
        holder,
        e,
        DetailField.EmergencyPhone,
        R.string.dk_iv_emergency_phone,
        d.emergencyPhone,
        IntakeField.EmergencyPhone,
    )
    Picks(e.options?.callTimes.orEmpty(), d.callTime, R.string.dk_iv_call_time) {
        holder.setDetail(DetailField.CallTime, it)
    }
    Field(holder, DetailField.DoctorName, R.string.dk_iv_doctor_name, d.doctorName)
    Phone(holder, e, DetailField.DoctorPhone, R.string.dk_iv_doctor_phone, d.doctorPhone, IntakeField.DoctorPhone)
    Field(holder, DetailField.DoctorAddress, R.string.dk_iv_doctor_address, d.doctorAddress)
    V7Label(stringResource(R.string.dk_iv_sec_found))
    Picks(
        e.options?.heardVia.orEmpty(),
        d.heardVia,
        R.string.dk_iv_heard,
    ) { holder.setDetail(DetailField.HeardVia, it) }
    if (d.heardVia.isNotEmpty()) Field(holder, DetailField.HeardViaText, R.string.dk_iv_heard_text, d.heardViaText)
    Field(holder, DetailField.ReferredBy, R.string.dk_iv_referred, d.referredBy)
    V7Label(stringResource(R.string.dk_iv_sec_medical))
    Field(holder, DetailField.HealthOther, R.string.dk_iv_health_other, d.healthOther)
    if (e.female) {
        V7Label(stringResource(R.string.dk_iv_sec_women))
        YesNo(R.string.dk_iv_pregnant, d.pregnant, holder::setPregnant)
        if (d.pregnant == true) {
            val bad = e.errors[IntakeField.DueDate] != null
            SkTextField(
                value = d.dueDate,
                onValueChange = { holder.setDetail(DetailField.DueDate, it) },
                label = stringResource(R.string.dk_iv_due_date),
                placeholder = stringResource(R.string.dk_iv_due_hint),
                isError = bad,
                supportingText = if (bad) stringResource(R.string.dk_iv_err_invalid) else null,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
        YesNo(R.string.dk_iv_nursing, d.nursing, holder::setNursing)
    }
    e.saveError?.let { Text(stringResource(it.message()), style = v7(13f), color = SkTheme.palette.error.color) }
    if (e.saved) V7Muted(stringResource(R.string.dk_iv_edit_saved))
    SkPillButton(stringResource(R.string.dk_iv_edit_save), holder::save, Modifier.fillMaxWidth(), enabled = !e.saving)
}

@Composable
private fun Field(
    holder: IntakeEditHolder,
    field: DetailField,
    label: Int,
    value: String,
) = SkTextField(value = value, onValueChange = { holder.setDetail(field, it) }, label = stringResource(label))

/** A phone: the masked text read-only when the server hid it, else a number field. */
@Composable
private fun Phone(
    holder: IntakeEditHolder,
    e: IntakeEditState.Editing,
    field: DetailField,
    label: Int,
    value: String,
    key: IntakeField,
) {
    val masked = e.masked[field]
    if (masked != null) {
        V7Label(stringResource(label))
        V7Muted(masked)
    } else {
        val bad = e.errors[key] != null
        SkTextField(
            value = value,
            onValueChange = { holder.setDetail(field, it) },
            label = stringResource(label),
            isError = bad,
            supportingText = if (bad) stringResource(R.string.dk_iv_err_invalid) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        )
    }
}

@Composable
private fun Picks(
    choices: List<CheckInChoice>,
    selected: String,
    label: Int,
    onPick: (String) -> Unit,
) {
    if (choices.isEmpty()) return
    V7Label(stringResource(label))
    DeskWrap { choices.forEach { PickChip(it.label, it.code == selected, onClick = { onPick(it.code) }) } }
}

@Composable
private fun YesNo(
    label: Int,
    value: Boolean?,
    onPick: (Boolean?) -> Unit,
) {
    V7Label(stringResource(label))
    DeskWrap {
        PickChip(stringResource(R.string.dk_iv_yes), value == true, onClick = {
            onPick(
                if (value ==
                    true
                ) {
                    null
                } else {
                    true
                },
            )
        })
        PickChip(stringResource(R.string.dk_iv_no), value == false, onClick = {
            onPick(
                if (value ==
                    false
                ) {
                    null
                } else {
                    false
                },
            )
        })
    }
}
