package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.queue.ArrivalIntake
import com.aarogyam.staff.queue.IntakeDetail
import com.aarogyam.staff.queue.IntakeLine
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** What the patient told the QR form beyond the basics, read-only: "Label: value" lines, then the checklist. */
@Composable
internal fun ArrivalIntakeSummary(intake: ArrivalIntake) {
    if (intake.isEmpty) return
    val p = SkTheme.palette
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        intake.lines.forEach { detail ->
            Text(
                stringResource(R.string.checkin_in_line, stringResource(lineLabel(detail.line)), lineValue(detail)),
                style = v7(13f),
                color = p.onSurfaceVariant.color,
            )
        }
        if (intake.health.isNotEmpty()) {
            Text(
                stringResource(
                    R.string.checkin_in_line,
                    stringResource(R.string.checkin_in_health),
                    intake.health.joinToString(", "),
                ),
                style = v7(13f, FontWeight.SemiBold),
                color = p.onSurfaceVariant.color,
            )
        }
    }
}

@Composable
private fun lineValue(detail: IntakeDetail): String =
    when (detail.answer) {
        true -> stringResource(R.string.dk_iv_yes)
        false -> stringResource(R.string.dk_iv_no)
        null -> detail.value
    }

private fun lineLabel(line: IntakeLine): Int =
    when (line) {
        IntakeLine.BloodGroup -> R.string.dk_iv_blood
        IntakeLine.AltPhone -> R.string.dk_iv_alt_phone
        IntakeLine.EmergencyContact -> R.string.checkin_in_emergency
        IntakeLine.ReferredBy -> R.string.dk_iv_referred
        IntakeLine.CallTime -> R.string.dk_iv_call_time
        IntakeLine.Occupation -> R.string.dk_iv_occupation
        IntakeLine.HeardVia -> R.string.dk_iv_heard
        IntakeLine.FamilyDoctor -> R.string.dk_iv_doctor_name
        IntakeLine.FamilyDoctorAddress -> R.string.dk_iv_doctor_address
        IntakeLine.HealthOther -> R.string.dk_iv_health_other
        IntakeLine.Allergies -> R.string.dk_iv_allergies_text
        IntakeLine.Pregnant -> R.string.dk_iv_pregnant
        IntakeLine.DueDate -> R.string.dk_iv_due_date
        IntakeLine.Nursing -> R.string.dk_iv_nursing
    }
