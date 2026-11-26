package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.patients.PatientView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** A small "Details" card under the header: age and sex, phone and the address when one is on file. */
@Composable
internal fun PatientDetailsCard(view: PatientView) {
    val age = view.ageYears?.let { stringResource(R.string.pv_age_short, it) }
    val sex = view.sex.label()?.let { stringResource(it) }
    val ageSex = listOfNotNull(age, sex).joinToString(" · ")
    val address = view.address?.oneLine()?.ifEmpty { null }
    val rows =
        listOfNotNull(
            ageSex.ifEmpty { null }?.let { stringResource(R.string.pv_details_age_sex) to it },
            view.phone?.ifEmpty { null }?.let { stringResource(R.string.pv_edit_phone) to it },
            address?.let { stringResource(R.string.pv_details_address) to it },
        )
    if (rows.isEmpty()) return
    V7Card(Modifier.padding(start = Spacing.L.dp, end = Spacing.L.dp, top = 12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SectionHead(stringResource(R.string.pv_details_title))
            rows.forEach { (label, value) ->
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(label, style = v7(11.5f), color = SkTheme.palette.onSurfaceVariant.color)
                    Text(value, style = v7(14f), color = SkTheme.palette.onSurface.color)
                }
            }
        }
    }
}
