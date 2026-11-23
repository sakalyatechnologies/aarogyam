package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.glass.GroupHeader
import com.aarogyam.staff.android.ui.glass.GroupRow
import com.aarogyam.staff.android.ui.glass.KindTile
import com.aarogyam.staff.android.ui.glass.groupShape
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.today.InitialsAvatar
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.desk.DeskLookupState
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.DeskProfile
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatarShape
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * The mobile field in Clear Glass: a muted heading over one inset card with the phone icon and the number in large
 * tabular digits; typing formats as `98765 43210` and every change goes to [onTyped]. [autoFocus] opens the keypad at
 * once where the number is the only thing to do (it saves a tap).
 */
@Composable
fun DeskNumberField(
    typed: String,
    onTyped: (String) -> Unit,
    label: String,
    autoFocus: Boolean = false,
) {
    val p = SkTheme.palette
    val focus = remember { FocusRequester() }
    // Number pad first; "ABC" switches to letters for a name, and back.
    var letters by rememberSaveable { mutableStateOf(false) }
    if (autoFocus) LaunchedEffect(Unit) { focus.requestFocus() }
    val style =
        SkTypography.title.copy(
            fontSize = NUMBER_SIZE.sp,
            fontWeight = FontWeight.SemiBold,
            fontFeatureSettings = "tnum",
            color = p.onSurface.color,
        )
    Column {
        GroupHeader(label)
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = FIELD_MIN.dp)
                .background(p.card.color, RoundedCornerShape(FIELD_RADIUS.dp))
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SkIcon(Icons.of("phone"), p.onSurfaceVariant.color, size = 20.dp)
            BasicTextField(
                value = typed,
                onValueChange = { onTyped(DeskPhone.format(it)) },
                modifier = Modifier.weight(1f).focusRequester(focus).semantics { contentDescription = label },
                textStyle = style,
                singleLine = true,
                cursorBrush = SolidColor(p.primary.color),
                keyboardOptions =
                    KeyboardOptions(
                        keyboardType = if (letters) KeyboardType.Text else KeyboardType.Phone,
                    ),
                decorationBox = { inner ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (typed.isEmpty()) {
                            Text(
                                stringResource(R.string.dk_d9_lookup_placeholder),
                                style = style.copy(color = p.onSurfaceVariant.color.copy(alpha = HINT)),
                                maxLines = 1,
                            )
                        }
                        inner()
                    }
                },
            )
            TextButton(
                onClick = {
                    letters = !letters
                    focus.requestFocus()
                },
                modifier = Modifier.heightIn(min = 48.dp),
            ) {
                Text(
                    stringResource(if (letters) R.string.dk_d9_lookup_digits else R.string.dk_d9_lookup_letters),
                    style = SkTypography.bodyStrong,
                    color = p.primary.color,
                )
            }
        }
    }
}

/** A tappable row in an inset group with a tinted tile, such as "New patient on this number". */
@Composable
fun DeskActionRow(
    icon: String,
    text: String,
    index: Int,
    count: Int,
    onClick: () -> Unit,
) {
    GroupRow(index, count, onClick = onClick) {
        KindTile(icon, SkTone.Brand)
        Text(text, Modifier.weight(1f), style = SkTypography.bodyStrong, color = SkTheme.palette.primary.color)
    }
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
                    holder.search(DeskPhone.query(typed))
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
            DeskActionRow("plus", stringResource(R.string.dk_dx_home_new), 0, 1) {
                onNewPatient(DeskPhone.newPatientPhone(state.phone))
            }
        }

        is DeskLookupState.Matches, is DeskLookupState.CheckedIn -> {
            // Drawn by the caller.
        }
    }
}

/**
 * One profile on the number as an inset-group card (row [index] of [count]): a round avatar, name, age and sex, the
 * relation, and Check in on the right (or "Checked in" with the queue state). Collect and Family sit under it when
 * allowed. The last visit shows only when the lookup sends one.
 */
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
    index: Int = 0,
    count: Int = 1,
    onOpen: (() -> Unit)? = null,
    onBook: (() -> Unit)? = null,
) {
    val p = SkTheme.palette
    val name = profile.name.ifEmpty { profile.initials }
    val compact = checkInTitle == null && !profile.checkedInToday
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.card.color, groupShape(index, count))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            InitialsAvatar(name, AVATAR.dp, cool = profile.checkedInToday, shape = SkAvatarShape.Circle)
            val openLabel = stringResource(R.string.dk_d9_lookup_open_a11y)
            Column(
                Modifier
                    .weight(1f)
                    .then(
                        if (onOpen !=
                            null
                        ) {
                            Modifier.clickable(onClickLabel = openLabel, onClick = onOpen)
                        } else {
                            Modifier
                        },
                    ),
            ) {
                Text(name, style = SkTypography.bodyStrong, color = p.onSurface.color)
                Text(
                    patientLine(profile.number, profile.ageYears, profile.sex),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                )
                val relation = profile.relation
                if (relation != null && ofName != null) {
                    Text(
                        stringResource(R.string.dk_d9_lookup_relation_of, relationTitle(relation), ofName),
                        style = SkTypography.label,
                        color = SkTheme.colors.primaryText.color,
                    )
                }
                profile.lastVisit?.takeIf { it.length >= DAY_LENGTH }?.let { last ->
                    val day = DeskEarlier.dayText(last.take(DAY_LENGTH))
                    DeskMutedText(stringResource(R.string.dk_d9_lookup_last_visit, day))
                }
            }
            if (profile.checkedInToday) {
                SkChip(stringResource(R.string.dk_d9_lookup_checked_in), tone = SkTone.Success)
            } else if (compact) {
                SkPillButton(stringResource(R.string.dk_d9_lookup_check_in), onCheckIn)
            }
        }
        val state = profile.state.takeIf { profile.checkedInToday }
        val family = canFamily && profile.familyOf == null
        if (checkInTitle != null && !profile.checkedInToday) {
            SkPillButton(checkInTitle, onCheckIn, wide = true)
        }
        if (state != null || canCollect || family || onOpen != null || onBook != null) {
            DeskWrap {
                state?.let { SkChip(it.title(), tone = SkTone.Info) }
                val tonal = SkPillVariant.Tonal
                onOpen?.let { SkPillButton(stringResource(R.string.dk_d9_lookup_open), it, variant = tonal) }
                onBook?.let { SkPillButton(stringResource(R.string.dk_d9_lookup_book), it, variant = tonal) }
                if (canCollect) SkPillButton(stringResource(R.string.dk_d9_lookup_collect), onCollect, variant = tonal)
                if (family) SkPillButton(stringResource(R.string.dk_d9_family_section), onFamily, variant = tonal)
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
private const val NUMBER_SIZE = 26
private const val FIELD_MIN = 64
private const val FIELD_RADIUS = 20
private const val HINT = 0.6f
private const val AVATAR = 44
