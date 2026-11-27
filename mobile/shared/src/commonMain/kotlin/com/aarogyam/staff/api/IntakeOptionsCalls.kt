package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.IntakeOptions
import com.aarogyam.staff.api.model.PatientIntake
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/patients/intake-options` (`getIntakeOptions`): the lists the registration form offers; needs `patients.write`. */
suspend fun ClinicApi.intakeOptions(): Outcome<IntakeOptions, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/patients/intake-options")
    }

/** `GET /api/v1/patients/{id}/intake` (`getPatientIntake`): the case-paper fields; phones come masked without `patients.contact`. */
suspend fun ClinicApi.patientIntake(id: String): Outcome<PatientIntake, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/patients/${id.encodeURLPathPart()}/intake")
    }

/** `PUT /api/v1/patients/{id}/intake` (`setPatientIntake`): saves the case-paper fields; a masked phone sent back keeps the stored number. */
suspend fun ClinicApi.setPatientIntake(
    id: String,
    body: PatientIntake,
): Outcome<PatientIntake, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${id.encodeURLPathPart()}/intake")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
