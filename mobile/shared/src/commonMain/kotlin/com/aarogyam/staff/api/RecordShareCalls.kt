package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewRecordShare
import com.aarogyam.staff.api.model.RecordShare
import com.aarogyam.staff.api.model.RecordShares
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/patients/{id}/record-shares` (`listRecordShares`, patients.read): newest first, never token or PIN. */
internal suspend fun ClinicApi.recordShares(patientId: String): Outcome<RecordShares, ApiError> =
    client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/record-shares") }

/**
 * `POST /api/v1/patients/{id}/record-shares` (`createRecordShare`): [recordTypes] are `chart`, `xrays`, `bills`;
 * [expiresIn] is `1h`, `24h` or `7d`. The token and PIN come back once.
 */
internal suspend fun ClinicApi.createRecordShare(
    patientId: String,
    recordTypes: List<String>,
    expiresIn: String,
): Outcome<RecordShare, ApiError> =
    client.call {
        url("api/v1/patients/${patientId.encodeURLPathPart()}/record-shares")
        method = HttpMethod.Post
        contentType(ContentType.Application.Json)
        setBody(NewRecordShare(recordTypes = recordTypes, expiresIn = expiresIn))
    }
