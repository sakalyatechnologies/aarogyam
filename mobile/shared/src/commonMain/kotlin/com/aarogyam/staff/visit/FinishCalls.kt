package com.aarogyam.staff.visit

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.FinishRequest
import com.aarogyam.staff.api.model.FinishedVisit
import com.aarogyam.staff.api.model.IssueBlocked
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.BodyFailure
import com.sakalya.mobile.http.callWithErrorBody
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/**
 * `POST /api/v1/visits/{id}/finish` like `ClinicApi.finishVisit`, but a 409 `allergy_alerts`
 * (its own body, not the error envelope) comes back as [BodyFailure.body] beside the error.
 */
internal suspend fun ClinicApi.finishWithAlerts(
    visitId: String,
    body: FinishRequest,
): Outcome<FinishedVisit, BodyFailure<IssueBlocked>> =
    client.callWithErrorBody(HttpStatusCode.Conflict.value) {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/finish")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
