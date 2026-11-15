package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.desk.DeskLookupState
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.DeskProfile
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The mobile field; typing formats as `98765 43210` and every change goes to [onTyped]. */
@Composable
fun DeskNumberField(
    typed: String,
    onTyped: (String) -> Unit,
    label: String,
) {
    SkTextField(
        value = typed,
        onValueChange = { onTyped(DeskPhone.format(it)) },
        label = label,
        placeholder = "98765 43210",
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
    )
}

/** What the desk can do for one lookup state, apart from the matches (which the caller draws). */
@Composable
fun DeskLookupStatus(
    holder: DeskLookupStateHolder,
    state: DeskLookupState,
    typed: String,
    onNewPatient: (String) -> Unit,
) {
    when (state) {
        DeskLookupState.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.dk_d9_lookup_not_allowed_title),
                stringResource(R.string.dk_d9_lookup_not_allowed_message),
            )
        }

        DeskLookupState.Idle -> {
            DeskMutedText(stringResource(R.string.dk_dx_home_number_hint))
        }

        DeskLookupState.Looking -> {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(
                    Modifier.size(SPINNER.dp),
                    color = SkTheme.colors.primary.color,
                    strokeWidth = 2.dp,
                )
                DeskMutedText(stringResource(R.string.dk_d9_lookup_looking))
            }
        }

        is DeskLookupState.Failed -> {
            DeskErrorText(stringResource(state.error.message()))
            SkButton(
                stringResource(R.string.try_again),
                onClick = {
                    holder.search("")
                    holder.search(DeskPhone.digits(typed))
                },
                variant = SkButtonVariant.Secondary,
            )
        }

        is DeskLookupState.NoMatch -> {
            Text(
                stringResource(R.string.dk_d9_lookup_none_title),
                style = SkTypography.bodyStrong,
                color = SkTheme.colors.text.color,
            )
            SkButton(stringResource(R.string.dk_dx_home_new), onClick = {
                onNewPatient(state.phone)
            }, modifier = Modifier.fillMaxWidth())
        }

        is DeskLookupState.Matches, is DeskLookupState.CheckedIn -> {
            // Drawn by the caller.
        }
    }
}

/** One profile on the number: initials, name, age and sex, last visit, a "checked in" chip and the actions that fit. */
@Composable
fun DeskProfileRow(
    profile: DeskProfile,
    ofName: String?,
    canCollect: Boolean,
    canFamily: Boolean,
    onCheckIn: () -> Unit,
    onCollect: () -> Unit,
    onFamily: () -> Unit,
    checkInTitle: String? = null,
) {
    val colors = SkTheme.colors
    val name = profile.name.ifEmpty { profile.initials }
    SkCard(Modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
            SkAvatar(name, tone = if (profile.checkedInToday) SkTone.Brand else SkTone.Neutral)
            Column(Modifier.weight(1f)) {
                Text(name, style = SkTypography.bodyStrong, color = colors.text.color)
                Text(
                    patientLine(profile.number, profile.ageYears, profile.sex),
                    style = SkTypography.footnote,
                    color = colors.textMuted.color,
                )
                val relation = profile.relation
                if (relation != null && ofName != null) {
                    Text(
                        stringResource(R.string.dk_d9_lookup_relation_of, relationTitle(relation), ofName),
                        style = SkTypography.label,
                        color = colors.primaryText.color,
                    )
                }
                val last = profile.lastVisit?.takeIf { it.length >= DAY_LENGTH }
                DeskMutedText(
                    if (last == null) {
                        stringResource(R.string.dk_d9_lookup_last_visit_none)
                    } else {
                        stringResource(R.string.dk_d9_lookup_last_visit, DeskEarlier.dayText(last.take(DAY_LENGTH)))
                    },
                )
            }
        }
        if (profile.checkedInToday) {
            DeskWrap {
                SkChip(stringResource(R.string.dk_d9_lookup_checked_in), tone = SkTone.Success)
                profile.state?.let { SkChip(it.title(), tone = SkTone.Info) }
            }
        }
        DeskWrap {
            if (!profile.checkedInToday) {
                SkButton(checkInTitle ?: stringResource(R.string.dk_d9_lookup_check_in), onClick = onCheckIn)
            }
            if (canCollect) {
                SkButton(
                    stringResource(R.string.dk_d9_lookup_collect),
                    onClick = onCollect,
                    variant = SkButtonVariant.Secondary,
                )
            }
            if (canFamily && profile.familyOf == null) {
                SkButton(
                    stringResource(R.string.dk_d9_family_section),
                    onClick = onFamily,
                    variant = SkButtonVariant.Secondary,
                )
            }
        }
    }
}

/** Doctor chips on a picked profile: who to check in with. */
@Composable
fun DeskDoctorChips(
    doctors: List<DeskDoctor>,
    current: DeskDoctor?,
    onPick: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
        DeskLabel(stringResource(R.string.dk_dx_home_doctor))
        DeskWrap {
            doctors.forEach { d ->
                PickChip(doctorLabel(d.name), selected = d.id == current?.id, onClick = { onPick(d.id) })
            }
        }
    }
}

private const val SPINNER = 18
private const val DAY_LENGTH = 10
