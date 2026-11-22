package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.walkin.IntakeDone
import com.aarogyam.staff.walkin.IntakeField
import com.aarogyam.staff.walkin.IntakeForm
import com.aarogyam.staff.walkin.IntakeFormHolder
import com.aarogyam.staff.walkin.IntakeProblem
import com.aarogyam.staff.walkin.IntakeSubmitError
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * One scrolling form for a new patient: details, allergies, consent, signature, photo, doctor; one Save and queue.
 * [phone] is prefilled when the desk already typed it; [family] lists the people on that number the patient can be
 * linked to. [onDone] runs after "Next patient".
 */
@Composable
fun IntakeScreen(
    holder: IntakeFormHolder,
    phone: String?,
    family: List<DeskFamilyAnchor>,
    onDone: () -> Unit,
) {
    val form by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(holder) { if (phone != null && form.phone.isEmpty()) holder.setPhone(phone) }
    val done = form.done
    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.ML.dp),
    ) {
        if (done != null) {
            DoneCard(done) {
                holder.reset()
                onDone()
            }
        } else {
            IntakeFields(holder, form, family)
        }
    }
}

@Composable
private fun IntakeFields(
    holder: IntakeFormHolder,
    form: IntakeForm,
    family: List<DeskFamilyAnchor>,
) {
    var clearToken by remember { mutableIntStateOf(0) }
    var photo by remember { mutableStateOf<ByteArray?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
        Text(stringResource(R.string.dk_iv_title), style = SkTypography.title, color = SkTheme.colors.text.color)
        form.submitError?.let { DeskNotice(submitText(it)) }
        IntakeDetails(holder, form)
        if (form.showFamily && family.isNotEmpty()) IntakeFamily(holder, family)
        AllergySection(holder, form)
        ConsentSection(holder, form)
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DeskLabel(stringResource(R.string.dk_iv_sign))
            SkButton(
                stringResource(R.string.dk_iv_sign_clear),
                onClick = { clearToken++ },
                variant = SkButtonVariant.Secondary,
            )
        }
        IntakeSignaturePad(clearToken, stringResource(R.string.dk_iv_sign_a11y), holder::setSignature)
        Problem(form, IntakeField.Signature)
        DeskLabel(stringResource(R.string.dk_iv_photo))
        DeskPhotoPicker(
            photo = photo,
            labels =
                DeskPhotoLabels(
                    stringResource(R.string.dk_iv_photo_camera),
                    stringResource(R.string.dk_iv_photo_library),
                    stringResource(R.string.dk_iv_photo_remove),
                    stringResource(R.string.dk_iv_photo),
                ),
            onPhoto = {
                photo = it
                holder.setPhoto(it)
            },
        )
        DoctorSection(holder, form)
        if (form.showReason) {
            Field(form, IntakeField.Reason, stringResource(R.string.dk_iv_reason), form.reason, holder::setReason)
        }
        SkButton(
            stringResource(R.string.dk_iv_save),
            onClick = holder::saveAndQueue,
            enabled = !form.submitting,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun IntakeDetails(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    var useAge by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        Field(
            form,
            IntakeField.Phone,
            stringResource(R.string.dk_iv_phone),
            form.phone,
            holder::setPhone,
            KeyboardType.Phone,
        )
        Field(form, IntakeField.Name, stringResource(R.string.dk_iv_name), form.name, holder::setName)
        SkSegmented(
            listOf(stringResource(R.string.dk_iv_dob), stringResource(R.string.dk_iv_age)),
            if (useAge) 1 else 0,
            { useAge = it == 1 },
        )
        if (useAge) {
            Field(
                form,
                IntakeField.Birth,
                stringResource(R.string.dk_iv_age),
                form.age,
                holder::setAge,
                KeyboardType.Number,
            )
        } else {
            Field(
                form,
                IntakeField.Birth,
                stringResource(R.string.dk_iv_dob),
                form.dateOfBirth,
                { holder.setDateOfBirth(intakeDateText(it)) },
                KeyboardType.Number,
                stringResource(R.string.dk_iv_dob_hint),
            )
        }
        Field(
            form,
            IntakeField.Email,
            stringResource(R.string.dk_iv_email),
            form.email,
            holder::setEmail,
            KeyboardType.Email,
        )
        DeskLabel(stringResource(R.string.dk_iv_sex))
        val sexes = listOf(Sex.Female, Sex.Male, Sex.Other)
        SkSegmented(
            sexes.map { sex -> sex.label()?.let { stringResource(it) }.orEmpty() },
            sexes.indexOf(form.sex),
            { holder.setSex(sexes[it]) },
        )
    }
}

@Composable
private fun Field(
    form: IntakeForm,
    field: IntakeField,
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardType = KeyboardType.Text,
    placeholder: String? = null,
) {
    val problem = form.errors[field]
    SkTextField(
        value = value,
        onValueChange = onChange,
        label = label,
        placeholder = placeholder,
        isError = problem != null,
        supportingText = problem?.let { stringResource(problemText(field, it)) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
    )
}

@Composable
private fun Problem(
    form: IntakeForm,
    field: IntakeField,
) {
    form.errors[field]?.let { DeskErrorText(stringResource(problemText(field, it))) }
}

@Composable
private fun AllergySection(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    DeskLabel(stringResource(R.string.dk_iv_allergies))
    DeskWrap {
        PickChip(
            stringResource(R.string.dk_iv_allergies_none),
            form.noKnownAllergies,
            onClick = holder::toggleNoKnownAllergies,
        )
        form.allergyPicks.forEach { label ->
            PickChip(label, label in form.allergies, onClick = { holder.toggleAllergy(label) })
        }
    }
    Problem(form, IntakeField.Allergies)
}

@Composable
private fun ConsentSection(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        form.notice?.let { notice ->
            DeskLabel(notice.label)
            SkCard(Modifier.fillMaxWidth()) {
                Text(notice.body, style = SkTypography.callout, color = SkTheme.colors.text.color)
            }
        }
        ToggleRow(stringResource(R.string.dk_iv_readaloud), form.readAloud, holder::setReadAloud)
        Problem(form, IntakeField.Consent)
        ToggleRow(stringResource(R.string.dk_iv_reminders), form.reminders, holder::setReminders)
    }
}

@Composable
private fun ToggleRow(
    text: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = SkTheme.colors.primary.color))
    }
}

@Composable
private fun DoctorSection(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    if (form.doctors.isEmpty()) return
    DeskLabel(stringResource(R.string.dk_iv_doctor))
    DeskWrap {
        PickChip(stringResource(R.string.dk_iv_doctor_any), form.practitionerId == null, onClick = {
            holder.setPractitioner(null)
        })
        form.doctors.forEach { d ->
            PickChip(d.name, form.practitionerId == d.id, onClick = { holder.setPractitioner(d.id) })
        }
    }
}

/** "Family of" when the number already has patients: none is picked at first, so a new patient who only shares the phone costs no taps. */
@Composable
private fun IntakeFamily(
    holder: IntakeFormHolder,
    people: List<DeskFamilyAnchor>,
) {
    var anchor by remember { mutableStateOf<DeskFamilyAnchor?>(null) }
    var relation by remember { mutableStateOf(DeskRelation.Child) }
    val send = { a: DeskFamilyAnchor?, r: DeskRelation -> holder.setFamilyOf(a?.id, r.wire) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        DeskLabel(stringResource(R.string.dk_d9_family_of_whom))
        DeskWrap {
            PickChip(
                stringResource(R.string.dk_iv_family_none),
                anchor == null,
                onClick = {
                    anchor = null
                    send(null, relation)
                },
            )
            people.forEach { p ->
                PickChip(
                    p.name,
                    anchor == p,
                    onClick = {
                        anchor = p
                        send(p, relation)
                    },
                )
            }
        }
        if (anchor != null) {
            DeskLabel(stringResource(R.string.dk_d9_family_relation))
            RelationChips(relation) {
                relation = it
                send(anchor, it)
            }
        }
    }
}

@Composable
private fun DoneCard(
    done: IntakeDone,
    onNext: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(Spacing.XL.dp), verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
        Text(
            stringResource(R.string.dk_iv_done, done.tokenNumber),
            style = SkTypography.title,
            color = SkTheme.colors.text.color,
        )
        if (done.filesQueued > 0) DeskMutedText(stringResource(R.string.dk_iv_done_files, done.filesQueued))
        if (done.filesRefused != null) DeskErrorText(stringResource(R.string.dk_iv_done_refused))
        SkButton(stringResource(R.string.dk_iv_next), onClick = onNext, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun submitText(error: IntakeSubmitError): String =
    when (error) {
        IntakeSubmitError.NeedsConnection -> stringResource(R.string.dk_iv_offline)
        IntakeSubmitError.NotWired -> stringResource(R.string.dk_iv_notwired)
        is IntakeSubmitError.Server -> stringResource(error.error.message())
    }

private fun problemText(
    field: IntakeField,
    problem: IntakeProblem,
): Int =
    when {
        field == IntakeField.Consent -> R.string.dk_iv_err_consent
        field == IntakeField.Signature -> R.string.dk_iv_err_signature
        field == IntakeField.Birth && problem == IntakeProblem.InFuture -> R.string.dk_iv_err_birth_future
        field == IntakeField.Birth && problem == IntakeProblem.Required -> R.string.dk_iv_err_birth_required
        problem == IntakeProblem.Required -> R.string.dk_iv_err_required
        else -> R.string.dk_iv_err_invalid
    }
