package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.clinic.ClinicPickerState
import com.aarogyam.staff.clinic.ClinicPickerStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The person's clinics; tapping one opens it. */
@Composable
fun ClinicPickerScreen(
    holder: ClinicPickerStateHolder,
    onSignOut: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize()) {
        SkTopBar(stringResource(R.string.clinics_title), actions = {
            BarAction(stringResource(R.string.sign_out), SkTheme.colors.onBrandDark.color, onSignOut)
        })
        Box(Modifier.weight(1f).navigationBarsPadding()) {
            when (val current = state) {
                ClinicPickerState.Loading -> {
                    LoadingIndicator()
                }

                ClinicPickerState.Empty -> {
                    SkEmptyState(
                        stringResource(R.string.clinics_empty_title),
                        stringResource(R.string.clinics_empty_message),
                    )
                }

                is ClinicPickerState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.clinics_title),
                        stringResource(current.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::retry,
                    )
                }

                is ClinicPickerState.Choose -> {
                    ClinicList(current, holder::select)
                }
            }
        }
    }
}

@Composable
private fun ClinicList(
    state: ClinicPickerState.Choose,
    onSelect: (String) -> Unit,
) {
    LazyColumn(contentPadding = PaddingValues(Spacing.ML.dp)) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                    modifier = Modifier.padding(Spacing.SM.dp),
                )
            }
        }
        item {
            SkCard(contentPadding = 0.dp) {
                state.clinics.forEachIndexed { index, clinic ->
                    if (index > 0) SkDivider()
                    SkListRow(
                        title = clinic.name,
                        subtitle = clinic.roleName,
                        onClick = { onSelect(clinic.slug) },
                        leading = { SkAvatar(clinic.name, tone = SkTone.Brand) },
                        trailing =
                            if (state.opening == clinic.slug) {
                                { SkChip(stringResource(R.string.clinic_opening), tone = SkTone.Info) }
                            } else {
                                null
                            },
                    )
                }
            }
        }
    }
}
