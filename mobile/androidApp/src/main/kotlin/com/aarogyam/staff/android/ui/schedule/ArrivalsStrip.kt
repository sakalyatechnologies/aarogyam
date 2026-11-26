package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.desk.relationTitle
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.walkin.MatchRow
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.android.ui.walkin.SomeoneNewRow
import com.aarogyam.staff.queue.ArrivalRow
import com.aarogyam.staff.queue.ArrivalsHolder
import com.aarogyam.staff.queue.ArrivalsState
import com.aarogyam.staff.walkin.DoctorOption
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.color

/** "N checked in by QR" on the desk queue; a tap opens the sheet where each arrival is accepted or dismissed. */
@Composable
fun ArrivalsStrip(holder: ArrivalsHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    val shown = state as? ArrivalsState.Shown ?: return
    var open by rememberSaveable { mutableStateOf(false) }
    val p = SkTheme.palette
    if (shown.count > 0) {
        Text(
            pluralStringResource(R.plurals.checkin_strip, shown.count, shown.count),
            style = v7(13.5f, FontWeight.Bold),
            color = p.onTertiaryContainer.color,
            modifier =
                Modifier
                    .padding(top = 8.dp)
                    .fillMaxWidth()
                    .background(p.tertiaryContainer.color, RoundedCornerShape(16.dp))
                    .clickable(role = Role.Button) { open = true }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
        )
    }
    if (open) {
        SkModalSheet(stringResource(R.string.checkin_title), {
            open = false
            holder.clearMessage()
        }) {
            if (shown.notice != null) {
                Text(stringResource(R.string.checkin_handled), style = v7(13f), color = p.error.color)
            }
            shown.error?.let { Text(stringResource(it.message()), style = v7(13f), color = p.error.color) }
            if (shown.rows.isEmpty()) {
                Text(stringResource(R.string.checkin_empty), style = v7(14f), color = p.onSurfaceVariant.color)
            }
            shown.rows.forEach { ArrivalCard(it, shown.canAccept, shown.doctors, holder) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ArrivalCard(
    row: ArrivalRow,
    canAccept: Boolean,
    doctors: List<DoctorOption>,
    holder: ArrivalsHolder,
) {
    val p = SkTheme.palette
    SkCard(contentPadding = 12.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(row.name, style = v7(16f, FontWeight.Bold), color = p.onSurface.color)
            Text(row.phone, style = v7(13f), color = p.onSurfaceVariant.color)
            if (row.reasons.isNotEmpty()) {
                Text(row.reasons.joinToString(", "), style = v7(13f), color = p.onSurfaceVariant.color)
            }
            ArrivalIntakeSummary(row.intake)
            if (canAccept) {
                if (row.matches.isNotEmpty()) {
                    Text(stringResource(R.string.checkin_pick), style = v7(12.5f), color = p.onSurfaceVariant.color)
                }
                row.matches.forEach { match ->
                    MatchRow(
                        match,
                        chosen = row.chosenPatientId == match.id,
                        onClick = { holder.choose(row.id, match.id) },
                    )
                    SkDivider()
                }
                if (row.relatives.isNotEmpty()) {
                    Text(
                        stringResource(R.string.checkin_relatives),
                        style = v7(12.5f),
                        color = p.onSurfaceVariant.color,
                    )
                    row.relatives.forEach { kin ->
                        SkListRow(
                            title = kin.name,
                            subtitle = kin.number + " · " + relationTitle(kin.relation),
                            onClick = { holder.choose(row.id, kin.id) },
                            leading = { SkAvatar(kin.name) },
                            trailing =
                                if (row.chosenPatientId == kin.id) {
                                    { SkChip(stringResource(R.string.walk_in_selected), tone = SkTone.Success) }
                                } else {
                                    null
                                },
                        )
                        SkDivider()
                    }
                }
                SomeoneNewRow(
                    stringResource(R.string.checkin_new_patient),
                    chosen = row.chosenPatientId == null,
                    onClick = { holder.choose(row.id, null) },
                )
                if (doctors.isNotEmpty()) {
                    Text(stringResource(R.string.walk_in_doctor), style = v7(12.5f), color = p.onSurfaceVariant.color)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PickChip(
                            stringResource(R.string.walk_in_doctor_any),
                            selected = row.chosenDoctorId == null,
                            onClick = { holder.chooseDoctor(row.id, null) },
                        )
                        doctors.forEach { doctor ->
                            PickChip(
                                doctor.name,
                                selected = row.chosenDoctorId == doctor.id,
                                onClick = { holder.chooseDoctor(row.id, doctor.id) },
                            )
                        }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (canAccept) {
                    SkPillButton(
                        stringResource(R.string.checkin_add),
                        { holder.accept(row.id) },
                        Modifier.weight(1f),
                        enabled = !row.busy,
                    )
                }
                SkPillButton(
                    stringResource(R.string.checkin_dismiss),
                    { holder.dismiss(row.id) },
                    Modifier.weight(1f),
                    variant = SkPillVariant.Tonal,
                    enabled = !row.busy,
                )
            }
        }
    }
}
