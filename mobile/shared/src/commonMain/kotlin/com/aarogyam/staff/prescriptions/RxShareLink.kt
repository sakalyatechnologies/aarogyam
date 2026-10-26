package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import kotlinx.datetime.toLocalDateTime

/** Makes the patient's link and PIN for an issued prescription. */
internal suspend fun shareView(
    clinic: ClinicContext,
    id: String,
): Outcome<ShareView, ApiError> =
    when (val result = clinic.api.sharePrescription(id)) {
        is Outcome.Success -> {
            val link = result.value
            val expires = parseInstant(link.expiresAt)?.toLocalDateTime(clinic.timeZone)
            Outcome.Success(
                ShareView(
                    url = "${clinic.api.origin}/shared/${link.token}",
                    pin = link.pin,
                    expiresAt = expires?.let { ClinicMoment(it.date, it.time) },
                ),
            )
        }

        is Outcome.Failure -> {
            result
        }
    }
