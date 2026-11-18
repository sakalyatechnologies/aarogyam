package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.V7Label
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.booking.PatientLanguage
import com.aarogyam.staff.booking.QuickRegisterStateHolder
import com.aarogyam.staff.booking.RegisterProblem
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The search found nobody: the full patient fields at once (name from the search), and one
 * Register and book. Once the patient is made, [onRegistered] goes on to the booking sheet for them.
 */
@Composable
internal fun RegisterAndBook(
    holder: QuickRegisterStateHolder,
    searched: String,
    onRegistered: (String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var tried by remember { mutableStateOf(false) }
    LaunchedEffect(searched) { holder.start(searched) }
    LaunchedEffect(state.createdId) { state.createdId?.let(onRegistered) }
    val sexes = listOf(Sex.Female, Sex.Male, Sex.Other)
    val sexLabels = sexes.associateWith { sex -> sex.label()?.let { stringResource(it) }.orEmpty() }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        V7Label(stringResource(R.string.sh_s_reg_title))
        SkField(stringResource(R.string.sh_s_reg_name), state.name, holder::setName)
        V7Label(stringResource(R.string.sh_s_reg_sex))
        SkChoiceChips(
            options = sexes,
            selected = setOfNotNull(state.sex),
            onToggle = { holder.setSex(if (it == state.sex) null else it) },
            label = { sexLabels.getValue(it) },
        )
        SkField(stringResource(R.string.sh_s_reg_age), state.age, holder::setAge)
        SkField(stringResource(R.string.sh_s_reg_mobile), state.mobile, holder::setMobile)
        SkField(stringResource(R.string.sh_s_reg_email), state.email, holder::setEmail)
        V7Label(stringResource(R.string.sh_s_reg_language))
        SkChoiceChips(
            options = PatientLanguage.entries,
            selected = setOf(state.language),
            onToggle = holder::setLanguage,
            label = { it.ownName() },
        )
        val problem = if (tried) holder.problem(state) else null
        val text = problem?.let { stringResource(it.text()) } ?: state.error?.let { stringResource(it.message()) }
        text?.let { Text(it, style = v7(12.5f), color = SkTheme.palette.error.color) }
        SkPillButton(stringResource(R.string.sh_s_reg_submit), {
            tried = true
            holder.register()
        }, wide = true, loading = state.saving)
    }
}

/** Each language in its own script. */
private fun PatientLanguage.ownName(): String =
    when (this) {
        PatientLanguage.English -> "English"
        PatientLanguage.Hindi -> "हिन्दी"
        PatientLanguage.Marathi -> "मराठी"
        PatientLanguage.Gujarati -> "ગુજરાતી"
    }

private fun RegisterProblem.text(): Int =
    when (this) {
        RegisterProblem.NameRequired -> R.string.sh_s_reg_name_required
        RegisterProblem.AgeInvalid -> R.string.sh_s_reg_age_invalid
        RegisterProblem.MobileInvalid -> R.string.sh_s_reg_mobile_invalid
        RegisterProblem.EmailInvalid -> R.string.sh_s_reg_email_invalid
    }
