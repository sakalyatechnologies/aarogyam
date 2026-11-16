package com.aarogyam.staff.android.ui.visit

import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.aarogyam.staff.chart.TreatmentStatus
import com.aarogyam.staff.visit.NoteSave
import com.aarogyam.staff.visit.VisitState
import com.aarogyam.staff.visit.VisitStateHolder
import kotlinx.coroutines.flow.first

/**
 * Logs each staged procedure through the tooth sheet's visit call, one at a time (as iOS `saveStaged`).
 * Returns the ones still to save: empty when all went through.
 */
internal suspend fun commitProcedures(
    sheet: ToothSheetStateHolder,
    staged: List<StagedProcedure>,
): List<StagedProcedure> {
    for ((index, item) in staged.withIndex()) {
        sheet.reset()
        sheet.setStatus(TreatmentStatus.Completed)
        sheet.chooseTreatment(item.term)
        item.surfaces.forEach(sheet::toggleSurface)
        sheet.chooseMaterial(item.material)
        sheet.save(item.tooth)
        val result = sheet.form.first { it.error != null || it.saved }
        if (result.error != null) return staged.drop(index)
    }
    return emptyList()
}

/** Waits for the note to be signed; false when signing fails or the visit is gone. */
internal suspend fun waitSigned(holder: VisitStateHolder): Boolean {
    var sawSaving = false
    var signed = false
    var failed = false
    holder.state.first { next ->
        val view = (next as? VisitState.Open)?.view
        when {
            view == null -> failed = true
            view.save == NoteSave.Saving -> sawSaving = true
            view.save == NoteSave.Signed -> signed = true
            view.save == NoteSave.Failed && sawSaving -> failed = true
        }
        signed || failed
    }
    return signed
}
