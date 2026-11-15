package com.aarogyam.staff.android.ui.desk

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.android.R
import com.aarogyam.staff.desk.DoctorAvailability
import com.sakalya.mobile.designcompose.SkChip

/** Doctors free, with a patient or away, and chairs free or busy, as chips that wrap. */
@Composable
fun DeskStrip(state: DeskStripState) {
    when (state) {
        DeskStripState.Hidden -> {
            // Nothing to draw.
        }

        DeskStripState.Loading -> {
            DeskMutedText(stringResource(R.string.dk_dx_strip_loading))
        }

        DeskStripState.Unavailable -> {
            DeskMutedText(stringResource(R.string.dk_dx_strip_unavailable))
        }

        is DeskStripState.Loaded -> {
            val strip = state.strip
            val chips =
                DeskStripRules.chips(
                    doctorsFree = strip.freeDoctors,
                    withPatient = strip.doctors.count { it.availability == DoctorAvailability.WithPatient },
                    away = strip.doctors.count { it.availability == DoctorAvailability.Away },
                    hasDoctors = strip.doctors.isNotEmpty(),
                    chairsFree = strip.freeChairs,
                    chairsBusy = strip.chairs.size - strip.freeChairs,
                    hasChairs = strip.chairs.isNotEmpty(),
                )
            DeskWrap {
                chips.forEach { chip ->
                    val res =
                        when (chip.kind) {
                            StripKind.DoctorsFree -> R.string.dk_dx_strip_doctors_free
                            StripKind.WithPatient -> R.string.dk_dx_strip_with_patient
                            StripKind.Away -> R.string.dk_dx_strip_away
                            StripKind.ChairsFree -> R.string.dk_dx_strip_chairs_free
                            StripKind.ChairsBusy -> R.string.dk_dx_strip_chairs_busy
                        }
                    SkChip(stringResource(res, chip.count), tone = chip.tone)
                }
            }
        }
    }
}
