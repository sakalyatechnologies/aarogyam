package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.walkin.FamilyMemberForm
import com.aarogyam.staff.walkin.FamilyResult
import com.aarogyam.staff.walkin.IntakeField
import com.aarogyam.staff.walkin.IntakeForm
import com.aarogyam.staff.walkin.IntakeFormHolder
import com.aarogyam.staff.walkin.IntakeProblem
import com.aarogyam.staff.walkin.MemberRelation
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTextField

/** "Who is the visit for?": the patient alone (default), or family members who each get a profile and a link. */
@Composable
fun IntakeVisitFor(
    holder: IntakeFormHolder,
    form: IntakeForm,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        DeskLabel(stringResource(R.string.dk_iv_for_title))
        SkSegmented(
            listOf(stringResource(R.string.dk_iv_for_self), stringResource(R.string.dk_iv_for_family)),
            if (form.forFamily) 1 else 0,
            { holder.setForFamily(it == 1) },
        )
        if (form.forFamily) {
            form.members.forEachIndexed { index, member -> MemberCard(holder, form, member, index + 1) }
            form.errors[IntakeField.Members]?.let { DeskErrorText(stringResource(R.string.dk_iv_err_members)) }
            SkButton(
                stringResource(R.string.dk_iv_member_add),
                onClick = holder::addMember,
                variant = SkButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun MemberCard(
    holder: IntakeFormHolder,
    form: IntakeForm,
    member: FamilyMemberForm,
    number: Int,
) {
    val problems = form.memberErrors[member.key].orEmpty()
    var useAge by remember(member.key) { mutableStateOf(true) }
    SkCard {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { DeskLabel(stringResource(R.string.dk_iv_member_title, number)) }
                SkButton(
                    stringResource(R.string.dk_iv_member_remove),
                    onClick = { holder.removeMember(member.key) },
                    variant = SkButtonVariant.Secondary,
                )
            }
            MemberField(problems[IntakeField.Name], R.string.dk_iv_name, member.name) {
                holder.setMemberName(member.key, it)
            }
            SkSegmented(
                listOf(stringResource(R.string.dk_iv_age), stringResource(R.string.dk_iv_dob)),
                if (useAge) 0 else 1,
                { useAge = it == 0 },
            )
            if (useAge) {
                MemberField(problems[IntakeField.Birth], R.string.dk_iv_age, member.age, KeyboardType.Number) {
                    holder.setMemberAge(member.key, it)
                }
            } else {
                MemberField(problems[IntakeField.Birth], R.string.dk_iv_dob, member.dateOfBirth, KeyboardType.Number) {
                    holder.setMemberDateOfBirth(member.key, intakeDateText(it))
                }
            }
            DeskLabel(stringResource(R.string.dk_iv_sex))
            val sexes = listOf(Sex.Female, Sex.Male, Sex.Other)
            SkSegmented(
                sexes.map { sex -> sex.label()?.let { stringResource(it) }.orEmpty() },
                sexes.indexOf(member.sex),
                { holder.setMemberSex(member.key, sexes[it]) },
            )
            DeskLabel(stringResource(R.string.dk_iv_member_relation))
            DeskWrap {
                MemberRelation.entries.forEach {
                    PickChip(relationTitle(it.wire), member.relation == it, onClick = {
                        holder.setMemberRelation(member.key, it)
                    })
                }
            }
            MemberField(problems[IntakeField.Phone], R.string.dk_iv_member_phone, member.phone, KeyboardType.Phone) {
                holder.setMemberPhone(member.key, it)
            }
        }
    }
}

@Composable
private fun MemberField(
    problem: IntakeProblem?,
    label: Int,
    value: String,
    keyboard: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit,
) {
    SkTextField(
        value = value,
        onValueChange = onChange,
        label = stringResource(label),
        isError = problem != null,
        supportingText = problem?.let { stringResource(problemRes(it)) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
    )
}

private fun problemRes(problem: IntakeProblem): Int =
    if (problem == IntakeProblem.Required) R.string.dk_iv_err_required else R.string.dk_iv_err_invalid

/** After saving: which family members were not made or not linked (the others are saved). */
@Composable
fun IntakeFamilyOutcome(results: List<FamilyResult>) {
    results.filter { it.failed }.forEach {
        DeskErrorText(
            stringResource(
                if (it.patientId == null) R.string.dk_iv_done_family_failed else R.string.dk_iv_done_family_unlinked,
                it.name,
            ),
        )
    }
}
