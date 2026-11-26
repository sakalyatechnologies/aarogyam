package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Patient
import com.aarogyam.staff.api.model.PatientChanges
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/**
 * `PATCH /api/v1/patients/{id}` (`updatePatient`, patients.write; phone and email also need
 * patients.contact): fields left out stay as they are. [rowVersion] goes in `If-Match`; 412 when the
 * record changed since it was read.
 */
suspend fun ClinicApi.updatePatient(
    id: String,
    rowVersion: Long,
    changes: PatientChanges,
): Outcome<Patient, ApiError> =
    client.call {
        method = HttpMethod.Patch
        url("api/v1/patients/${id.encodeURLPathPart()}")
        header("If-Match", "\"$rowVersion\"")
        contentType(ContentType.Application.Json)
        setBody(changes)
    }
