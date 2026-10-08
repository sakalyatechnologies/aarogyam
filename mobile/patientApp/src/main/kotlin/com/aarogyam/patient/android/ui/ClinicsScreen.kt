package com.aarogyam.patient.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.android.R
import com.aarogyam.patient.clinics.ClinicsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** My clinics: the linked clinics, a clinic's code to add one, or asking a clinic to connect. */
@Composable
fun ClinicsScreen(
    holder: ClinicsStateHolder,
    onDone: () -> Unit,
    onSignOut: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val onPrimary = SkTheme.colors.onPrimary.color
    PatientScreen(
        stringResource(R.string.clinics_title),
        actions = {
            if (state.clinics.isEmpty()) {
                BarAction(stringResource(R.string.sign_out), onPrimary, onSignOut)
            } else {
                BarAction(stringResource(R.string.done), onPrimary, onDone)
            }
        },
    ) {
        if (state.clinics.isEmpty() && !state.loading) {
            item {
                SkCard {
                    SectionTitle(stringResource(R.string.clinics_empty_title))
                    BodyText(stringResource(R.string.clinics_empty_message), muted = true)
                }
            }
        }
        state.error?.let { error -> item { ErrorState(error, holder::refresh) } }
        if (state.clinics.isNotEmpty()) {
            item {
                SkCard(contentPadding = Spacing.S.dp) {
                    state.clinics.forEach { clinic ->
                        SkListRow(
                            clinic.name,
                            subtitle = stringResource(R.string.clinic_number, clinic.patientNumber),
                            leading = { SkAvatar(clinic.name) },
                        )
                    }
                }
            }
        }
        state.linked?.let { clinic -> item { SkCard { BodyText(stringResource(R.string.added_clinic, clinic.name)) } } }
        item {
            SkCard {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
                    SectionTitle(stringResource(R.string.add_clinic_title))
                    val error = state.linkError?.let { stringResource(it.message()) }
                    SkTextField(
                        value = state.code,
                        onValueChange = holder::onCodeChange,
                        label = stringResource(R.string.code_from_clinic),
                        placeholder = stringResource(R.string.code_hint),
                        supportingText = error,
                        isError = error != null,
                        keyboardOptions =
                            KeyboardOptions(
                                capitalization = KeyboardCapitalization.Characters,
                                autoCorrectEnabled = false,
                                imeAction = ImeAction.Done,
                            ),
                    )
                    SkButton(
                        stringResource(R.string.add_clinic),
                        holder::submitCode,
                        Modifier.fillMaxWidth(),
                        enabled = !state.busy,
                    )
                }
            }
        }
        item {
            SkCard {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
                    SectionTitle(stringResource(R.string.no_code_title))
                    BodyText(stringResource(R.string.no_code_message), muted = true)
                    SkTextField(
                        value = state.clinicSlug,
                        onValueChange = holder::onClinicChange,
                        label = stringResource(R.string.clinic_address_label),
                        keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Send),
                    )
                    if (state.requested) BodyText(stringResource(R.string.asked_clinic))
                    SkButton(
                        stringResource(R.string.ask_clinic),
                        holder::submitRequest,
                        Modifier.fillMaxWidth(),
                        variant = SkButtonVariant.Secondary,
                        enabled = !state.busy,
                    )
                }
            }
        }
    }
}
