package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.walkin.LookupState
import com.aarogyam.staff.walkin.WalkInForm
import com.aarogyam.staff.walkin.WalkInStateHolder
import com.aarogyam.staff.walkin.Who
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTone

/** Mobile first; registered patients with the number show as soon as it is complete. */
@Composable
internal fun MobileSection(
    form: WalkInForm,
    holder: WalkInStateHolder,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        SkTextField(
            value = form.mobile,
            onValueChange = holder::setMobile,
            label = stringResource(R.string.walk_in_mobile),
            supportingText = stringResource(R.string.walk_in_mobile_hint),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
        )
        when (val lookup = form.lookup) {
            LookupState.Idle -> {}

            LookupState.Looking -> {
                Hint(R.string.walk_in_looking)
            }

            LookupState.Failed -> {
                Hint(R.string.walk_in_lookup_failed)
            }

            is LookupState.Matches -> {
                Matches(lookup, form.who, holder)
            }
        }
    }
}

@Composable
private fun Matches(
    lookup: LookupState.Matches,
    who: Who,
    holder: WalkInStateHolder,
) {
    if (lookup.items.isEmpty()) Hint(R.string.walk_in_no_match)
    SkCard(contentPadding = 0.dp) {
        lookup.items.forEach { match ->
            val chosen = who is Who.Existing && who.id == match.id
            val age = match.ageYears?.let { stringResource(R.string.age_years, it) }
            val sex = match.sex.label()?.let { stringResource(it) }
            SkListRow(
                title = match.name,
                subtitle = listOfNotNull(match.number, age, sex).joinToString(" · "),
                onClick = { holder.pick(match) },
                leading = { SkAvatar(match.name) },
                trailing =
                    if (chosen) {
                        (
                            {
                                SkChip(
                                    stringResource(R.string.walk_in_selected),
                                    tone = SkTone.Success,
                                )
                            }
                        )
                    } else {
                        null
                    },
            )
            SkDivider()
        }
        SkListRow(
            title = stringResource(R.string.walk_in_someone_new),
            onClick = holder::someoneNew,
            trailing =
                if (who ==
                    Who.New
                ) {
                    ({ SkChip(stringResource(R.string.walk_in_selected), tone = SkTone.Success) })
                } else {
                    null
                },
        )
    }
}

/** Name, age and sex for someone not registered yet. */
@Composable
internal fun NewPatientSection(
    form: WalkInForm,
    holder: WalkInStateHolder,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        SkTextField(value = form.name, onValueChange = holder::setName, label = stringResource(R.string.walk_in_name))
        SkTextField(
            value = form.age,
            onValueChange = holder::setAge,
            label = stringResource(R.string.walk_in_age),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        Label(R.string.walk_in_sex)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            listOf(Sex.Female, Sex.Male, Sex.Other).forEach { sex ->
                val text = sex.label()?.let { stringResource(it) } ?: return@forEach
                FilterChip(selected = form.sex == sex, onClick = { holder.setSex(sex) }, label = { Text(text) })
            }
        }
    }
}
