package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.dayLabel
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.patient.BookingDays
import com.aarogyam.staff.android.ui.patient.V7Label
import com.aarogyam.staff.android.ui.patient.V7Muted
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.calendar.RescheduleState
import com.aarogyam.staff.calendar.RescheduleStateHolder
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate

private const val DAYS = 14

/** The new day, doctor and free slot for a move, with the booking sheet's chips. */
@Composable
internal fun ColumnScope.RescheduleBody(
    holder: RescheduleStateHolder,
    state: RescheduleState,
    today: LocalDate,
    onBack: () -> Unit,
) {
    Text(stringResource(R.string.appt_move_title), style = v7(16f), color = SkTheme.palette.onSurface.color)
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
    V7Label(stringResource(R.string.sh_s_book_time))
    when {
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
    SkPillButton(
        stringResource(R.string.appt_move_submit),
        holder::move,
        variant = SkPillVariant.Warm,
        wide = true,
        loading = state.saving,
        enabled = state.canMove,
    )
    SkPillButton(stringResource(R.string.appt_back), onBack, variant = SkPillVariant.Ghost, wide = true)
}
