package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.dayLabel
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.schedule.label
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.booking.BookingState
import com.aarogyam.staff.booking.BookingStateHolder
import com.aarogyam.staff.booking.BookingWarningKind
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.designcompose.SkCheckDraw
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate
import kotlinx.datetime.todayIn
import kotlin.time.Clock

@Composable
private fun BookingWarningKind.label(): String =
    stringResource(
        when (this) {
            BookingWarningKind.PractitionerBusy -> R.string.pv_book_warn_busy
            BookingWarningKind.PractitionerOnLeave -> R.string.pv_book_warn_leave
            BookingWarningKind.OutsideWorkingHours -> R.string.pv_book_warn_hours
            BookingWarningKind.Other -> R.string.pv_book_warn_other
        },
    )

/** "Book appointment" for one patient: doctor, day, a free slot and optionally a chair, on the shared `BookingStateHolder`. */
@Composable
internal fun BookSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    name: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val today = remember { Clock.System.todayIn(clinic.timeZone) }
    val holder = remember { graph.booking(clinic, patientId, today, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    val doctor = state.doctors.firstOrNull { it.id == state.doctorId }?.label
    SkModalSheet(
        title = stringResource(R.string.pv_book_title),
        subtitle = listOfNotNull(name.ifEmpty { null }, doctor).joinToString(" · "),
        onDismiss = onDismiss,
    ) {
        when {
            state.booked != null -> {
                Done(state, onDismiss)
            }

            !state.allowed -> {
                SkEmptyState(
                    stringResource(R.string.pv_book_title),
                    stringResource(R.string.pv_book_not_allowed),
                )
            }

            else -> {
                Form(holder, state, today)
            }
        }
    }
}

@Composable
private fun Form(
    holder: BookingStateHolder,
    state: BookingState,
    today: kotlinx.datetime.LocalDate,
) {
    val p = SkTheme.palette
    if (state.doctors.size > 1) {
        SkChoiceChips(
            state.doctors,
            setOfNotNull(state.doctors.firstOrNull { it.id == state.doctorId }),
            { holder.chooseDoctor(it.id) },
            { it.label },
        )
    }
    var calendar by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val calendarLabel = stringResource(R.string.pv_book_calendar)
        Box(
            Modifier
                .size(CALENDAR_BUTTON.dp)
                .clip(CircleShape)
                .background(p.primaryContainer.color)
                .clickable(role = Role.Button, onClickLabel = calendarLabel) { calendar = true }
                .semantics { contentDescription = calendarLabel },
            contentAlignment = Alignment.Center,
        ) {
            SkIcon(Icons.of("cal"), p.onPrimaryContainer.color, size = CALENDAR_GLYPH.dp)
        }
        Row(
            Modifier.weight(1f).horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            BookingDays.next(DAYS, today).forEach { day ->
                SkChoiceChip(day.dayLabel(), day == state.date, { holder.chooseDate(day) })
            }
        }
    }
    if (calendar) CalendarDialog(state.date, today, holder::chooseDate) { calendar = false }
    V7Label(stringResource(R.string.pv_book_free, state.date.dayLabel()))
    when {
        state.loadingSlots -> {
            V7Muted(stringResource(R.string.pv_loading))
        }

        state.slots.isEmpty() -> {
            V7Muted(
                stringResource(
                    if (state.doctorId ==
                        null
                    ) {
                        R.string.pv_book_pick_doctor
                    } else {
                        R.string.pv_book_no_slots
                    },
                ),
            )
        }

        else -> {
            val times = state.slots.associateWith { it.time.display() }
            SkChoiceChips(
                state.slots,
                setOfNotNull(state.slots.firstOrNull { it.starts == state.chosen?.starts }),
                holder::chooseSlot,
                { times.getValue(it) },
            )
        }
    }
    if (state.chairs.isNotEmpty()) {
        SkChoiceChips(
            state.chairs,
            setOfNotNull(state.chairs.firstOrNull { it.id == state.chairId }),
            { holder.chooseChair(if (it.id == state.chairId) null else it.id) },
            { it.label },
        )
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        V7Icon("wa", p.onSurfaceVariant.color, 14.dp)
        Text(stringResource(R.string.pv_book_reminder), style = v7(12f), color = p.onSurfaceVariant.color)
    }
    state.error?.let {
        Text(
            stringResource(it.message()),
            style = v7(12.5f, FontWeight.SemiBold),
            color = p.error.color,
        )
    }
    SkPillButton(
        state.chosen?.let { stringResource(R.string.pv_book_cta, it.time.display()) }
            ?: stringResource(R.string.pv_book_pick),
        holder::book,
        wide = true,
        loading = state.saving,
        enabled = state.canBook,
    )
}

private const val DAYS = 7
private const val CALENDAR_BUTTON = 44
private const val CALENDAR_GLYPH = 22
private const val DAY_MILLIS = 86_400_000L

/** A month calendar from [today] on; choosing a day sets the booking day. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarDialog(
    selected: LocalDate,
    today: LocalDate,
    onPick: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    val first = today.toEpochDays() * DAY_MILLIS
    val picker =
        rememberDatePickerState(
            initialSelectedDateMillis = selected.toEpochDays() * DAY_MILLIS,
            selectableDates =
                object : SelectableDates {
                    override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis >= first
                },
        )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                onClick = {
                    picker.selectedDateMillis?.let { onPick(LocalDate.fromEpochDays((it / DAY_MILLIS).toInt())) }
                    onDismiss()
                },
            ) { Text(stringResource(R.string.done)) }
        },
    ) { DatePicker(picker) }
}

@Composable
private fun Done(
    state: BookingState,
    onDismiss: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SkCheckDraw(Modifier.size(72.dp))
        Text(
            stringResource(R.string.pv_book_done),
            style = v7(18f, FontWeight.ExtraBold),
            color = SkTheme.palette.onSurface.color,
        )
        state.warnings.forEach { V7Pill(it.label(), PillKind.Warm) }
        state.overlaps.forEach { V7Pill(it.label(), PillKind.Warm) }
        SkPillButton(stringResource(R.string.done), onDismiss, wide = true)
    }
}
