package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.dayLabel
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.BookingDays
import com.aarogyam.staff.android.ui.patient.PillKind
import com.aarogyam.staff.android.ui.patient.V7Label
import com.aarogyam.staff.android.ui.patient.V7Muted
import com.aarogyam.staff.android.ui.patient.V7Pill
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.today.InitialsAvatar
import com.aarogyam.staff.booking.BookingOverlap
import com.aarogyam.staff.booking.BookingState
import com.aarogyam.staff.booking.BookingStateHolder
import com.aarogyam.staff.booking.BookingWarningKind
import com.aarogyam.staff.booking.VisitKind
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.PatientRow
import com.aarogyam.staff.patients.PatientsState
import com.sakalya.mobile.designcompose.SkCheckDraw
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.todayIn
import kotlin.time.Clock

private const val DAYS = 14
private const val PICKER_ROWS = 20

/** Book an appointment: pick the patient, then doctor, day, kind, chair, free slot and reason. */
@Composable
fun BookFlow(
    graph: AppGraph,
    clinic: ClinicContext,
    onDismiss: () -> Unit,
) {
    var patientId by rememberSaveable { mutableStateOf<String?>(null) }
    val id = patientId
    if (id == null) {
        PatientPicker(graph, clinic, onDismiss) { patientId = it }
    } else {
        BookingSheet(graph, clinic, id, onDismiss)
    }
}

@Composable
private fun PatientPicker(
    graph: AppGraph,
    clinic: ClinicContext,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember { graph.patients(clinic, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }
    SkModalSheet(
        title = stringResource(R.string.sh_s_book_title),
        subtitle = stringResource(R.string.sh_s_book_pick),
        onDismiss = onDismiss,
    ) {
        SkSearchField(text, {
            text = it
            holder.search(it)
        }, stringResource(R.string.patients_search))
        when (val s = state) {
            PatientsState.NotAllowed -> {
                SkEmptyState(
                    stringResource(R.string.patients_not_allowed_title),
                    stringResource(R.string.patients_not_allowed_message),
                )
            }

            is PatientsState.Loading -> {
                SkLoadingIndicator(stringResource(R.string.sh_s_loading))
            }

            is PatientsState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.patients_title),
                    stringResource(s.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::retry,
                )
            }

            is PatientsState.Loaded -> {
                if (s.items.isEmpty() && text.trim().length >= 2 && "patients.write" in clinic.permissions) {
                    // Nobody by that name: register them here, then book for the new patient.
                    val register = remember { graph.quickRegister(clinic, scope) }
                    RegisterAndBook(register, text, onPick)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        s.items.take(PICKER_ROWS).forEachIndexed { i, row -> PickRow(row, i, onPick) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PickRow(
    row: PatientRow,
    index: Int,
    onPick: (String) -> Unit,
) {
    val p = SkTheme.palette
    val age = row.ageYears?.let { stringResource(R.string.age_years, it) }
    val sex = row.sex.label()?.let { stringResource(it) }
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.card.color, RoundedCornerShape(14.dp))
            .clickable(role = Role.Button) { onPick(row.id) }
            .padding(vertical = 10.dp, horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        InitialsAvatar(row.name, 36.dp, cool = index % 2 == 1)
        Column {
            Text(row.name, style = v7(13.5f, FontWeight.Bold), color = p.onSurface.color)
            Text(
                listOfNotNull(row.number, age, sex).joinToString(" · "),
                style = v7(11.5f),
                color = p.onSurfaceVariant.color,
            )
        }
    }
}

@Composable
private fun BookingSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val today = remember { Clock.System.todayIn(clinic.timeZone) }
    val holder = remember { graph.booking(clinic, patientId, today, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    SkModalSheet(
        title = stringResource(R.string.sh_s_book_title),
        subtitle = state.date.dayLabel(),
        onDismiss = onDismiss,
    ) {
        when {
            !state.allowed -> {
                SkEmptyState(
                    stringResource(R.string.sh_s_book_not_allowed),
                    stringResource(R.string.walk_in_not_allowed_message),
                )
            }

            state.booked != null -> {
                Booked(state, onDismiss)
            }

            else -> {
                Form(holder, state, today)
            }
        }
    }
}

@Composable
private fun Booked(
    state: BookingState,
    onDismiss: () -> Unit,
) {
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        SkCheckDraw(Modifier.size(64.dp))
        Text(
            stringResource(R.string.sh_s_book_done),
            style = v7(18f, FontWeight.ExtraBold),
            color = SkTheme.palette.onSurface.color,
        )
        state.warnings.forEach { V7Pill(stringResource(it.label()), PillKind.Warm) }
        state.overlaps.forEach { V7Pill(it.label(), PillKind.Warm) }
        SkPillButton(stringResource(R.string.sh_s_book_close), onDismiss, wide = true)
    }
}

/** "This patient is also booked 10:00–10:30 with Dr. Rao, Chair 2". */
@Composable
internal fun BookingOverlap.label(): String =
    stringResource(
        R.string.sh_s_book_overlap,
        "${starts.display()}–${ends.display()}",
        listOfNotNull(doctor, chair).joinToString(", "),
    )

private fun BookingWarningKind.label(): Int =
    when (this) {
        BookingWarningKind.PractitionerBusy -> R.string.sh_s_book_warn_busy
        BookingWarningKind.PractitionerOnLeave -> R.string.sh_s_book_warn_leave
        BookingWarningKind.OutsideWorkingHours -> R.string.sh_s_book_warn_hours
        BookingWarningKind.Other -> R.string.sh_s_book_warn_other
    }

private fun VisitKind.label(): Int =
    when (this) {
        VisitKind.New -> R.string.sh_s_book_kind_new
        VisitKind.FollowUp -> R.string.sh_s_book_kind_follow
        VisitKind.Procedure -> R.string.sh_s_book_kind_proc
        VisitKind.Emergency -> R.string.sh_s_book_kind_emerg
    }

@Composable
private fun Form(
    holder: BookingStateHolder,
    state: BookingState,
    today: kotlinx.datetime.LocalDate,
) {
    V7Label(stringResource(R.string.sh_s_book_doctor))
    SkChoiceChips(
        state.doctors,
        setOfNotNull(state.doctors.firstOrNull { it.id == state.doctorId }),
        { holder.chooseDoctor(it.id) },
        { it.label },
    )
    V7Label(stringResource(R.string.sh_s_book_day))
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BookingDays
            .next(
                DAYS,
                today,
            ).forEach { SkChoiceChip(it.dayLabel(), it == state.date, { holder.chooseDate(it) }) }
    }
    V7Label(stringResource(R.string.sh_s_book_kind))
    val kinds = VisitKind.entries
    val labels = kinds.associateWith { stringResource(it.label()) }
    SkChoiceChips(kinds, setOf(state.kind), holder::chooseKind, { labels.getValue(it) })
    if (state.chairs.isNotEmpty()) {
        V7Label(stringResource(R.string.sh_s_book_chair))
        SkChoiceChips(
            state.chairs,
            setOfNotNull(state.chairs.firstOrNull { it.id == state.chairId }),
            { holder.chooseChair(if (it.id == state.chairId) null else it.id) },
            { it.label },
        )
    }
    V7Label(stringResource(R.string.sh_s_book_time))
    Slots(holder, state)
    SkField(stringResource(R.string.sh_s_book_reason), state.reason, holder::setReason)
    state.error?.let { Text(stringResource(it.message()), style = v7(12f), color = SkTheme.palette.error.color) }
    SkPillButton(
        stringResource(R.string.sh_s_book_book),
        holder::book,
        variant = SkPillVariant.Warm,
        wide = true,
        loading = state.saving,
        enabled = state.canBook,
    )
}

@Composable
private fun Slots(
    holder: BookingStateHolder,
    state: BookingState,
) {
    when {
        state.doctorId == null -> {
            V7Muted(stringResource(R.string.sh_s_book_choose_doctor))
        }

        state.loadingSlots -> {
            SkLoadingIndicator(stringResource(R.string.sh_s_loading))
        }

        state.slots.isEmpty() -> {
            V7Muted(stringResource(R.string.sh_s_book_no_slots))
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
}
