package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.desk.DeskWrap
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.desk.FamilyChip
import com.aarogyam.staff.desk.FamilyState
import com.aarogyam.staff.desk.FamilyStateHolder
import com.aarogyam.staff.desk.chip
import com.sakalya.mobile.design.Spacing

/**
 * The patient's relatives as tappable chips ("Parent of Asha", "Child of Ravi") under the details; a tap opens that
 * profile. Nothing shows without relatives or `patients.read`. [reload] changes when the Family sheet closes.
 */
@Composable
fun PatientFamilyChips(
    clinic: ClinicContext,
    patientId: String,
    reload: Any?,
    onOpen: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val holder = remember(patientId, reload) { FamilyStateHolder(clinic, patientId, scope) }
    val state by holder.state.collectAsStateWithLifecycle()
    val items = (state as? FamilyState.Loaded)?.items.orEmpty()
    if (items.isEmpty()) return
    DeskWrapPadded {
        items.forEach { PickChip(chipText(it.chip(), it.name), false, onClick = { onOpen(it.patientId) }) }
    }
}

@Composable
private fun DeskWrapPadded(content: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Box(Modifier.padding(horizontal = Spacing.L.dp, vertical = 12.dp)) {
        DeskWrap(content)
    }
}

@Composable
private fun chipText(
    chip: FamilyChip,
    name: String,
): String =
    stringResource(
        when (chip) {
            FamilyChip.ParentOf -> R.string.pv_fam_parent_of
            FamilyChip.ChildOf -> R.string.pv_fam_child_of
            FamilyChip.SpouseOf -> R.string.pv_fam_spouse_of
            FamilyChip.SiblingOf -> R.string.pv_fam_sibling_of
            FamilyChip.WardOf -> R.string.pv_fam_ward_of
            FamilyChip.RelatedTo -> R.string.pv_fam_related_to
        },
        name,
    )
