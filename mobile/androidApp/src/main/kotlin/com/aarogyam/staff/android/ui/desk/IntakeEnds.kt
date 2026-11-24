package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.walkin.IntakeForm
import com.aarogyam.staff.walkin.IntakeFormHolder
import com.aarogyam.staff.walkin.IntakeNext
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant

/**
 * What the intake may do after saving a new patient besides checking them in: book a visit ([onBook], given with
 * appointments.write) and open the saved patient ([onOpen]). Without them only "Save and queue" shows.
 */
data class IntakeEnds(
    val onBook: ((patientId: String, name: String) -> Unit)? = null,
    val onOpen: ((patientId: String) -> Unit)? = null,
)

/** Check in now (primary), or save to book a visit, or just save: one form for all three (founder, 23 Nov). */
@Composable
fun IntakeEndButtons(
    holder: IntakeFormHolder,
    form: IntakeForm,
    ends: IntakeEnds,
) {
    if (ends.onBook == null && ends.onOpen == null) {
        SkButton(
            stringResource(R.string.dk_iv_save),
            onClick = holder::saveAndQueue,
            enabled = !form.submitting,
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        SkButton(
            stringResource(R.string.dk_iv_end_check_in),
            onClick = holder::saveAndQueue,
            enabled = !form.submitting,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            if (ends.onBook != null) {
                SkButton(
                    stringResource(R.string.dk_iv_end_book),
                    onClick = { holder.save(IntakeNext.Book) },
                    enabled = !form.submitting,
                    variant = SkButtonVariant.Secondary,
                    modifier = Modifier.weight(1f),
                )
            }
            SkButton(
                stringResource(R.string.dk_iv_end_save_only),
                onClick = { holder.save(IntakeNext.SaveOnly) },
                enabled = !form.submitting,
                variant = SkButtonVariant.Secondary,
                modifier = Modifier.weight(1f),
            )
        }
    }
}
