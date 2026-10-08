package com.aarogyam.patient.android.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.VisitStatus
import com.aarogyam.patient.android.R
import com.aarogyam.patient.booking.BookingError
import com.aarogyam.patient.booking.BookingStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkHeroCard
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.tone
import kotlinx.datetime.LocalTime

/** Booking: clinic, doctor, day, time, reason; the clinic's online booking rules apply. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BookScreen(
    holder: BookingStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(stringResource(R.string.book_title), onBack = onBack) {
        val booked = state.booked
        if (booked != null) {
            item {
                SkHeroCard(
                    kicker =
                        stringResource(
                            if (booked.status ==
                                VisitStatus.Confirmed
                            ) {
                                R.string.booked_confirmed
                            } else {
                                R.string.booked_requested
                            },
                        ),
                    title = booked.at?.dateTime().orEmpty(),
                    subtitle =
                        stringResource(
                            R.string.at_clinic,
                            stringResource(R.string.with_doctor, booked.doctorName),
                            booked.clinicName,
                        ),
                )
            }
            item { SkButton(stringResource(R.string.done), onBack, Modifier.fillMaxWidth()) }
            return@PatientScreen
        }
        state.error?.let { error ->
            item {
                SkCard {
                    BodyText(
                        stringResource(
                            when (error) {
                                BookingError.BookingOff -> R.string.booking_off
                                BookingError.SlotTaken -> R.string.slot_taken
                                BookingError.Offline -> R.string.error_offline
                                BookingError.Failed -> R.string.error_unknown
                            },
                        ),
                    )
                }
            }
        }
        if (state.clinics.size > 1) {
            item { SectionTitle(stringResource(R.string.choose_clinic)) }
            item {
                SkCard(contentPadding = Spacing.S.dp) {
                    state.clinics.forEach { clinic ->
                        SkListRow(clinic.name, onClick = { holder.selectClinic(clinic.id) }, trailing = {
                            if (clinic.id == state.clinicId) BodyText("✓")
                        })
                    }
                }
            }
        }
        if (state.doctors.isNotEmpty()) {
            item { SectionTitle(stringResource(R.string.choose_doctor)) }
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                    state.doctors.forEach { doctor ->
                        ChoiceChip(
                            state.doctorId == doctor.id,
                            { holder.selectDoctor(doctor.id) },
                            label = { Text(doctor.name) },
                        )
                    }
                }
            }
        }
        if (state.doctorId != null) {
            item { SectionTitle(stringResource(R.string.choose_day)) }
            item {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                ) {
                    state.days.forEach { day ->
                        val label = ClinicTime(day, LocalTime(0, 0)).date().substringBeforeLast(' ')
                        ChoiceChip(state.day == day, { holder.selectDay(day) }, label = { Text(label) })
                    }
                }
            }
            item { SectionTitle(stringResource(R.string.choose_time)) }
            item {
                if (state.loading) {
                    LoadingIndicator()
                } else if (state.slots.isEmpty()) {
                    BodyText(stringResource(R.string.no_slots), muted = true)
                } else {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                        state.slots.forEach { slot ->
                            ChoiceChip(state.slot == slot.startsAt, {
                                holder.selectSlot(slot.startsAt)
                            }, label = { Text(slot.at?.time().orEmpty()) })
                        }
                    }
                }
            }
        }
        if (state.slot != null) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
                    SkTextField(state.reason, holder::onReasonChange, stringResource(R.string.reason_label))
                    SkButton(
                        stringResource(R.string.confirm_booking),
                        holder::book,
                        Modifier.fillMaxWidth(),
                        enabled = !state.booking,
                    )
                }
            }
        }
    }
}

/** A pickable choice in the clinic's brand colours: solid brand when chosen. */
@Composable
private fun ChoiceChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
) {
    val brand = SkTheme.colors.tone(SkTone.Brand)
    FilterChip(
        selected,
        onClick,
        label = label,
        colors =
            FilterChipDefaults.filterChipColors(
                containerColor = SkTheme.colors.card.color,
                labelColor = SkTheme.colors.text.color,
                selectedContainerColor = brand.solid.color,
                selectedLabelColor = brand.on.color,
            ),
    )
}
