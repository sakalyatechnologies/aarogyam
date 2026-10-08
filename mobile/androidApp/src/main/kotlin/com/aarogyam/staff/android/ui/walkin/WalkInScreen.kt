package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.walkin.WalkInForm
import com.aarogyam.staff.walkin.WalkInProblem
import com.aarogyam.staff.walkin.WalkInState
import com.aarogyam.staff.walkin.WalkInStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The one-step walk-in: mobile, who, intake, doctor, then "Add to queue". */
@Composable
fun WalkInScreen(
    holder: WalkInStateHolder,
    onClose: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().imePadding()) {
        SkTopBar(
            title = stringResource(R.string.walk_in_title),
            subtitle = stringResource(R.string.walk_in_subtitle),
            actions = { BarAction(stringResource(R.string.walk_in_close), SkTheme.colors.onBrandDark.color, onClose) },
        )
        when (val current = state) {
            WalkInState.NotAllowed -> {
                SkEmptyState(
                    stringResource(R.string.walk_in_not_allowed_title),
                    stringResource(R.string.walk_in_not_allowed_message),
                )
            }

            is WalkInState.Done -> {
                SkEmptyState(
                    stringResource(R.string.walk_in_done_title, current.tokenNumber),
                    stringResource(R.string.walk_in_done_message, current.name),
                    actionLabel = stringResource(R.string.walk_in_another),
                    onAction = holder::startAnother,
                )
            }

            is WalkInState.Editing -> {
                WalkInFormView(current.form, holder)
            }
        }
    }
}

@Composable
private fun WalkInFormView(
    form: WalkInForm,
    holder: WalkInStateHolder,
) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.L.dp),
    ) {
        MobileSection(form, holder)
        if (form.showNewPatient) NewPatientSection(form, holder)
        AllergySection(form, holder)
        ConsentSection(form, holder::setReminders)
        DoctorSection(form, holder::setDoctor)
        val problem = form.problem?.message() ?: form.error?.message()
        if (problem != null) {
            Text(
                stringResource(problem),
                style = SkTypography.bodyText,
                color = SkTheme.colors.dangerText.color,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        SkButton(
            text = stringResource(if (form.submitting) R.string.walk_in_submitting else R.string.walk_in_submit),
            onClick = holder::submit,
            enabled = !form.submitting,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

private fun WalkInProblem.message(): Int =
    when (this) {
        WalkInProblem.PickPatient -> R.string.walk_in_problem_pick
        WalkInProblem.NameRequired -> R.string.walk_in_problem_name
        WalkInProblem.AgeInvalid -> R.string.walk_in_problem_age
    }
