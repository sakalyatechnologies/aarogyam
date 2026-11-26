package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.IntakeOptions
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.url
import io.ktor.http.HttpMethod

/** `GET /api/v1/patients/intake-options` (`getIntakeOptions`): the lists the registration form offers; needs `patients.write`. */
suspend fun ClinicApi.intakeOptions(): Outcome<IntakeOptions, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/patients/intake-options")
    }
