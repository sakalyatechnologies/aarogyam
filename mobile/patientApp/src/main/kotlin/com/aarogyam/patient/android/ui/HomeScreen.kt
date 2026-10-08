package com.aarogyam.patient.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.android.R
import com.aarogyam.patient.home.HomeState
import com.aarogyam.patient.home.HomeStateHolder
import com.aarogyam.patient.home.HomeView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkHeroCard
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkStatTile
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** Home: the next visit, booking, prescriptions and bills, from every linked clinic. */
@Composable
fun HomeScreen(
    holder: HomeStateHolder,
    onOpen: (String) -> Unit,
    onSignOut: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(
        stringResource(R.string.home_greeting),
        subtitle = stringResource(R.string.home_subtitle),
        actions = { BarAction(stringResource(R.string.sign_out), SkTheme.colors.onPrimary.color, onSignOut) },
    ) {
        when (val current = state) {
            HomeState.Loading -> item { LoadingIndicator() }
            is HomeState.Failed -> item { ErrorState(current.error, holder::refresh) }
            is HomeState.Loaded -> home(current.view, onOpen)
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.home(
    view: HomeView,
    onOpen: (String) -> Unit,
) {
    item {
        val next = view.next
        if (next == null) {
            SkCard {
                SectionTitle(stringResource(R.string.no_next_visit_title))
                BodyText(stringResource(R.string.no_next_visit_message), muted = true)
            }
        } else {
            SkHeroCard(
                kicker = stringResource(R.string.next_visit),
                title = next.at?.dateTime().orEmpty(),
                subtitle =
                    stringResource(
                        R.string.at_clinic,
                        stringResource(R.string.with_doctor, next.doctorName),
                        next.clinicName,
                    ),
                onClick = { onOpen(Routes.APPOINTMENTS) },
            )
        }
    }
    item {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton(stringResource(R.string.book_visit), { onOpen(Routes.BOOK) }, Modifier.fillMaxWidth())
            SkButton(
                stringResource(R.string.see_appointments),
                { onOpen(Routes.APPOINTMENTS) },
                Modifier.fillMaxWidth(),
                variant = SkButtonVariant.Secondary,
            )
        }
    }
    item {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
            SkStatTile(
                value = view.prescriptions.toString(),
                label = stringResource(R.string.prescriptions),
                modifier = Modifier.weight(1f),
                onClick = { onOpen(Routes.PRESCRIPTIONS) },
            )
            SkStatTile(
                value = if (view.balancePaise > 0) rupees(view.balancePaise) else stringResource(R.string.all_paid),
                label =
                    if (view.balancePaise >
                        0
                    ) {
                        stringResource(R.string.balance_due)
                    } else {
                        stringResource(R.string.bills)
                    },
                modifier = Modifier.weight(1f),
                onClick = { onOpen(Routes.BILLS) },
            )
        }
    }
    item { SectionTitle(stringResource(R.string.clinics_title)) }
    item {
        SkCard(contentPadding = Spacing.S.dp) {
            view.clinics.forEach { summary ->
                SkListRow(
                    summary.clinic.name,
                    subtitle = stringResource(R.string.clinic_number, summary.clinic.patientNumber),
                    leading = { SkAvatar(summary.clinic.name) },
                    trailing = {
                        BodyText(
                            if (summary.balancePaise >
                                0
                            ) {
                                rupees(summary.balancePaise)
                            } else {
                                stringResource(R.string.all_paid)
                            },
                            muted = true,
                        )
                    },
                    onClick = { onOpen(Routes.CLINICS) },
                )
            }
        }
    }
    item {
        SkButton(stringResource(R.string.add_clinic_title), {
            onOpen(Routes.CLINICS)
        }, Modifier.fillMaxWidth(), variant = SkButtonVariant.Secondary)
    }
}
