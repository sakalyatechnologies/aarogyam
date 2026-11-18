package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewToothStatus
import com.aarogyam.staff.api.model.ToothStatus
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/**
 * `PUT /api/v1/patients/{id}/dental-chart/teeth/{tooth}/status` (`setToothStatus`): the doctor's
 * health for one tooth, replacing any earlier one; no visit needed. The body's client id makes a
 * retry return the same status.
 */
suspend fun ClinicApi.setToothStatus(
    patientId: String,
    tooth: Int,
    body: NewToothStatus,
): Outcome<ToothStatus, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/status")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `DELETE /api/v1/patients/{id}/dental-chart/teeth/{tooth}/status` (`clearToothStatus`): back to what the findings suggest. */
suspend fun ClinicApi.clearToothStatus(
    patientId: String,
    tooth: Int,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Delete
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/status")
    }
