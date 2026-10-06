package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.calendar.CalendarEntry
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The tapped appointment's details, from the day already loaded: no further request. */
@Composable
fun AppointmentSheet(
    entry: CalendarEntry,
    onDismiss: () -> Unit,
    onOpenPatient: () -> Unit,
) {
    SkBottomSheet(title = entry.patientName, subtitle = entry.patientNumber, onDismiss = onDismiss) {
        SkChip(stringResource(entry.status.label()), tone = entry.status.tone())
        Detail(null, stringResource(R.string.appointment_when, entry.starts.display(), entry.ends.display()))
        Detail(stringResource(R.string.appointment_doctor), entry.practitioner)
        entry.room?.let { Detail(stringResource(R.string.appointment_room), it) }
        entry.reason?.let { Detail(stringResource(R.string.appointment_reason), it) }
        entry.notes?.let { Detail(stringResource(R.string.appointment_notes), it) }
        SkButton(
            stringResource(R.string.open_patient),
            onClick = onOpenPatient,
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp),
        )
    }
}

@Composable
private fun Detail(
    label: String?,
    value: String,
) {
    Column(Modifier.padding(top = Spacing.M.dp)) {
        label?.let { Text(it, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color) }
        Text(value, style = SkTypography.bodyText, color = SkTheme.colors.text.color)
    }
}
