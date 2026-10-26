package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.api.model.RxValues
import com.aarogyam.staff.api.updatePrescription
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome

/** Where the draft stands on the server (`POST` once, then `PATCH` per save). */
enum class DraftSave { None, Saving, Saved, Failed }

/** The prescription draft on the server: created on the first push, edited on every later one. */
internal class RxDraftSync(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val visitId: String?,
) {
    var id: String? = null
        private set

    /** Sends [lines] as the draft's medicines; the draft id, or the error. */
    suspend fun push(lines: List<RxLine>): Outcome<String, ApiError> {
        val values = RxValues(items = lines.map { it.toItem() }, encounterId = visitId)
        val known = id
        val answer =
            if (known == null) {
                clinic.api.createPrescription(patientId, values)
            } else {
                clinic.api.updatePrescription(known, values)
            }
        return when (answer) {
            is Outcome.Success -> Outcome.Success(answer.value.id.also { id = it })
            is Outcome.Failure -> answer
        }
    }
}
