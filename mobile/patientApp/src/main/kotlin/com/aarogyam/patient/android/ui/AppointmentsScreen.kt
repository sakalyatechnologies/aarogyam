package com.aarogyam.patient.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.AppointmentView
import com.aarogyam.patient.android.R
import com.aarogyam.patient.appointments.AppointmentsState
import com.aarogyam.patient.appointments.AppointmentsStateHolder
import com.aarogyam.patient.appointments.CancelError
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Upcoming and past appointments at every linked clinic, with Cancel while the clinic allows it. */
@Composable
fun AppointmentsScreen(
    holder: AppointmentsStateHolder,
    onBack: () -> Unit,
    onBook: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(stringResource(R.string.appointments_title), onBack = onBack) {
        when (val current = state) {
            AppointmentsState.Loading -> item { LoadingIndicator() }
            is AppointmentsState.Failed -> item { ErrorState(current.error, holder::refresh) }
            is AppointmentsState.Loaded -> loaded(current, holder, onBook)
        }
    }
}

private fun LazyListScope.loaded(
    state: AppointmentsState.Loaded,
    holder: AppointmentsStateHolder,
    onBook: () -> Unit,
) {
    state.cancelError?.let { error ->
        item {
            SkCard {
                BodyText(
                    stringResource(
                        if (error ==
                            CancelError.TooLate
                        ) {
                            R.string.cancel_too_late
                        } else {
                            R.string.cancel_failed
                        },
                    ),
                )
            }
        }
    }
    item { SectionTitle(stringResource(R.string.upcoming)) }
    if (state.upcoming.isEmpty()) {
        item {
            SkCard {
                BodyText(stringResource(R.string.no_upcoming), muted = true)
                SkButton(stringResource(R.string.book_visit), onBook, Modifier.fillMaxWidth())
            }
        }
    }
    items(state.upcoming, key = { "u" + it.id }) { visit ->
        VisitCard(visit, cancelling = state.cancelling == visit.id) { holder.cancel(visit.id) }
    }
    item { SectionTitle(stringResource(R.string.past)) }
    if (state.past.isEmpty()) item { SkCard { BodyText(stringResource(R.string.no_past), muted = true) } }
    items(state.past, key = { "p" + it.id }) { visit -> VisitCard(visit, cancelling = false, onCancel = null) }
}

@Composable
private fun VisitCard(
    visit: AppointmentView,
    cancelling: Boolean,
    onCancel: (() -> Unit)?,
) {
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    visit.at?.dateTime().orEmpty(),
                    Modifier.weight(1f),
                    style = SkTypography.headline,
                    color = SkTheme.colors.text.color,
                )
                StatusChip(visit.status)
            }
            BodyText(
                stringResource(
                    R.string.at_clinic,
                    stringResource(R.string.with_doctor, visit.doctorName),
                    visit.clinicName,
                ),
                muted = true,
            )
            if (onCancel != null && visit.canCancel) {
                SkButton(
                    stringResource(R.string.cancel_visit),
                    onCancel,
                    Modifier.fillMaxWidth(),
                    variant = SkButtonVariant.Secondary,
                    enabled = !cancelling,
                )
            }
        }
    }
}
