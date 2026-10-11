package com.aarogyam.staff.history

import com.aarogyam.staff.api.model.Invoice
import com.aarogyam.staff.api.model.Prescription
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Outcome

internal const val PATIENTS_READ = "patients.read"
internal const val CLINICAL_READ = "clinical.read"
internal const val BILLING_READ = "billing.read"

/**
 * An optional join: `null` (not asked) and a refusal both mean "not available" and the screen
 * still loads; any other failure fails the screen.
 */
internal fun <T> Outcome<T, ApiError>?.optional(): Outcome<T?, ApiError> =
    when (this) {
        null -> Outcome.Success(null)
        is Outcome.Success -> Outcome.Success(value)
        is Outcome.Failure -> if (error.kind == ApiErrorKind.Forbidden) Outcome.Success(null) else this
    }

/** The prescription written in [visitId]: the newest one that is not cancelled (lists are newest first). */
internal fun List<Prescription>?.forVisit(visitId: String): Prescription? =
    this?.firstOrNull { it.encounterId == visitId && it.status != "cancelled" }

/** The bill raised in [visitId]: the newest issued one (a draft is no bill yet, a void one no longer is). */
internal fun List<Invoice>?.forVisit(visitId: String): Invoice? =
    this?.firstOrNull { it.encounterId == visitId && it.status == "issued" }
