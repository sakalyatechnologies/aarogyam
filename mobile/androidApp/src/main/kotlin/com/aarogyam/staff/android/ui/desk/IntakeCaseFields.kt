package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.api.model.CheckInChoice
import com.aarogyam.staff.walkin.DetailField
import com.aarogyam.staff.walkin.HEALTH_NONE
import com.aarogyam.staff.walkin.IntakeField
import com.aarogyam.staff.walkin.IntakeForm
import com.aarogyam.staff.walkin.IntakeFormHolder
import com.aarogyam.staff.walkin.LookupState
import com.aarogyam.staff.walkin.PhoneMatchRow
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Personal, Contact, Medical history and (for a female patient) For women: every field optional. */
@Composable
internal fun IntakeCaseSections(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    if (!form.showDetails) return
    val d = form.details
    val options = form.options
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        DeskLabel(stringResource(R.string.dk_iv_sec_personal))
        Picks(options?.bloodGroups.orEmpty(), d.bloodGroup, R.string.dk_iv_blood) {
            holder.setDetail(DetailField.BloodGroup, it)
        }

        DeskLabel(stringResource(R.string.dk_iv_sec_contact))
        DetailText(
            form,
            holder,
            DetailField.AltPhone,
            R.string.dk_iv_alt_phone,
            d.altPhone,
            KeyboardType.Phone,
            IntakeField.AltPhone,
        )
        DetailText(form, holder, DetailField.EmergencyName, R.string.dk_iv_emergency_name, d.emergencyName)
        DetailText(
            form,
            holder,
            DetailField.EmergencyPhone,
            R.string.dk_iv_emergency_phone,
            d.emergencyPhone,
            KeyboardType.Phone,
            IntakeField.EmergencyPhone,
        )
        Picks(
            options?.callTimes.orEmpty(),
            d.callTime,
            R.string.dk_iv_call_time,
        ) { holder.setDetail(DetailField.CallTime, it) }
        DeskLabel(stringResource(R.string.dk_iv_language))
        DeskWrap {
            listOf("" to "English", "hi-IN" to "हिन्दी", "mr-IN" to "मराठी").forEach { (code, name) ->
                PickChip(name, d.language == code, onClick = { holder.setDetail(DetailField.Language, code) })
            }
        }
        DetailText(form, holder, DetailField.DoctorName, R.string.dk_iv_doctor_name, d.doctorName)
        DetailText(
            form,
            holder,
            DetailField.DoctorPhone,
            R.string.dk_iv_doctor_phone,
            d.doctorPhone,
            KeyboardType.Phone,
            IntakeField.DoctorPhone,
        )
        DetailText(form, holder, DetailField.DoctorAddress, R.string.dk_iv_doctor_address, d.doctorAddress)

        DeskLabel(stringResource(R.string.dk_iv_sec_found))
        DetailText(form, holder, DetailField.Occupation, R.string.dk_iv_occupation, d.occupation)
        Picks(
            options?.heardVia.orEmpty(),
            d.heardVia,
            R.string.dk_iv_heard,
        ) { holder.setDetail(DetailField.HeardVia, it) }
        if (d.heardVia.isNotEmpty()) {
            DetailText(
                form,
                holder,
                DetailField.HeardViaText,
                R.string.dk_iv_heard_text,
                d.heardViaText,
            )
        }
        DetailText(form, holder, DetailField.ReferredBy, R.string.dk_iv_referred, d.referredBy)

        DeskLabel(stringResource(R.string.dk_iv_sec_medical))
        DeskWrap {
            options?.healthFlags.orEmpty().filter { it.code != HEALTH_NONE }.forEach {
                PickChip(it.label, it.code in d.health, onClick = { holder.toggleHealth(it.code) })
            }
            PickChip(
                stringResource(R.string.dk_iv_health_none),
                HEALTH_NONE in d.health,
                onClick = { holder.toggleHealth(HEALTH_NONE) },
            )
        }
        DetailText(form, holder, DetailField.HealthOther, R.string.dk_iv_health_other, d.healthOther)
        DetailText(form, holder, DetailField.AllergiesText, R.string.dk_iv_allergies_text, d.allergiesText)

        if (form.showWomen) {
            DeskLabel(stringResource(R.string.dk_iv_sec_women))
            YesNo(R.string.dk_iv_pregnant, d.pregnant, holder::setPregnant)
            if (d.pregnant == true) {
                DetailText(
                    form,
                    holder,
                    DetailField.DueDate,
                    R.string.dk_iv_due_date,
                    d.dueDate,
                    KeyboardType.Number,
                    IntakeField.DueDate,
                    R.string.dk_iv_due_hint,
                )
            }
            YesNo(R.string.dk_iv_nursing, d.nursing, holder::setNursing)
        }
    }
}

@Composable
private fun DetailText(
    form: IntakeForm,
    holder: IntakeFormHolder,
    field: DetailField,
    label: Int,
    value: String,
    keyboard: KeyboardType = KeyboardType.Text,
    error: IntakeField? = null,
    hint: Int? = null,
) {
    val problem = error?.let { form.errors[it] }
    SkTextField(
        value = value,
        onValueChange = { holder.setDetail(field, it) },
        label = stringResource(label),
        placeholder = hint?.let { stringResource(it) },
        isError = problem != null,
        supportingText = if (error != null && problem != null) stringResource(problemText(error, problem)) else null,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
    )
}

@Composable
private fun Picks(
    choices: List<CheckInChoice>,
    selected: String,
    label: Int,
    onPick: (String) -> Unit,
) {
    if (choices.isEmpty()) return
    DeskLabel(stringResource(label))
    DeskWrap { choices.forEach { PickChip(it.label, it.code == selected, onClick = { onPick(it.code) }) } }
}

@Composable
private fun YesNo(
    label: Int,
    value: Boolean?,
    onPick: (Boolean?) -> Unit,
) {
    DeskLabel(stringResource(label))
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

/**
 * Under the mobile field: "Already registered: Name, age, SC-xxxx" for each patient on the typed number, with
 * Open profile, Book (with appointments.write) and "Add family member on this number".
 */
@Composable
internal fun IntakeLookupCard(
    holder: IntakeFormHolder,
    form: IntakeForm,
    ends: IntakeEnds,
) {
    val found = (form.lookup as? LookupState.Matches)?.items.orEmpty()
    if (found.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        found.forEach { row -> MatchCard(holder, form, row, ends) }
    }
}

@Composable
private fun MatchCard(
    holder: IntakeFormHolder,
    form: IntakeForm,
    row: PhoneMatchRow,
    ends: IntakeEnds,
) {
    val age = row.ageYears
    val text =
        if (age != null) {
            stringResource(R.string.dk_iv_found, row.name, age, row.number)
        } else {
            stringResource(R.string.dk_iv_found_no_age, row.name, row.number)
        }
    val linked = form.familyOf?.takeIf { it.patientId == row.id }
    SkCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            Text(text, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
            DeskWrap {
                ends.onOpen?.let { open ->
                    SkButton(
                        stringResource(R.string.dk_iv_open_profile),
                        { open(row.id) },
                        variant = SkButtonVariant.Secondary,
                    )
                }
                ends.onBook?.let { book ->
                    SkButton(
                        stringResource(R.string.dk_iv_book),
                        { book(row.id, row.name) },
                        variant = SkButtonVariant.Secondary,
                    )
                }
                if (form.showFamily && linked == null) {
                    SkButton(stringResource(R.string.dk_iv_add_family), {
                        holder.addFamilyOnNumber(row.id)
                    }, variant = SkButtonVariant.Secondary)
                }
            }
            if (linked != null) {
                DeskLabel(stringResource(R.string.dk_iv_family_relation, row.name))
                DeskWrap {
                    DeskRelation.entries.forEach {
                        PickChip(
                            relationTitle(it.wire),
                            linked.relation == it.wire,
                            onClick = { holder.setFamilyOf(row.id, it.wire) },
                        )
                    }
                }
            }
        }
    }
}
