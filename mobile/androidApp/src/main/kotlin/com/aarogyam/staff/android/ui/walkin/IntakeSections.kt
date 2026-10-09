package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.walkin.WalkInForm
import com.aarogyam.staff.walkin.WalkInStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** "No known allergies" or common substances; all patient-reported until the doctor confirms. */
@Composable
internal fun AllergySection(
    form: WalkInForm,
    holder: WalkInStateHolder,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        Label(R.string.walk_in_allergies)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            PickChip(
                stringResource(R.string.walk_in_no_known_allergies),
                selected = form.noKnownAllergies,
                onClick = holder::toggleNoKnownAllergies,
            )
            form.allergyPicks.forEach { label ->
                PickChip(label, selected = label in form.allergies, onClick = { holder.toggleAllergy(label) })
            }
        }
        Hint(R.string.walk_in_allergies_hint)
    }
}

/** The line read aloud, care consent (always) and reminders (optional), recorded as verbal. */
@Composable
internal fun ConsentSection(
    form: WalkInForm,
    onReminders: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
        Label(R.string.walk_in_consent)
        Text(
            stringResource(R.string.walk_in_consent_read),
            style = SkTypography.callout,
            color = SkTheme.colors.text.color,
        )
        Check(R.string.walk_in_consent_care, checked = true, enabled = false) {}
        Check(R.string.walk_in_consent_reminders, checked = form.reminders, enabled = true, onChange = onReminders)
    }
}

/** The doctor, if known; "Not yet known" (or tapping the chosen one again) clears it. */
@Composable
internal fun DoctorSection(
    form: WalkInForm,
    onDoctor: (String?) -> Unit,
) {
    if (form.doctors.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        Label(R.string.walk_in_doctor)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            PickChip(
                stringResource(R.string.walk_in_doctor_any),
                selected = form.doctorId == null,
                onClick = { onDoctor(null) },
            )
            form.doctors.forEach { doctor ->
                val chosen = form.doctorId == doctor.id
                PickChip(doctor.name, selected = chosen, onClick = { onDoctor(if (chosen) null else doctor.id) })
            }
        }
    }
}

@Composable
private fun Check(
    text: Int,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier.toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        val brand = SkTheme.colors.primary.color
        Checkbox(
            checked = checked,
            onCheckedChange = null,
            enabled = enabled,
            colors = CheckboxDefaults.colors(checkedColor = brand, disabledCheckedColor = brand.copy(alpha = DISABLED)),
        )
        Text(stringResource(text), style = SkTypography.bodyText, color = SkTheme.colors.text.color)
    }
}

@Composable
internal fun Label(text: Int) =
    Text(stringResource(text), style = SkTypography.label, color = SkTheme.colors.textMuted.color)

@Composable
internal fun Hint(text: Int) =
    Text(stringResource(text), style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)

private const val DISABLED = 0.6f
