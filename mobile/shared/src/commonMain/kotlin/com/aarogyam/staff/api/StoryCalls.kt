package com.aarogyam.staff.api

import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.JsonObject

/**
 * `GET /api/v1/visits/{id}/mouth` (`getVisitMouth`): the server-built mouth snapshot for Present
 * mode. Kept as raw JSON and handed to the story WebView untouched (no generated models).
 */
suspend fun ClinicApi.visitMouth(visitId: String): Outcome<JsonObject, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/visits/${visitId.encodeURLPathPart()}/mouth")
    }

/**
 * `GET /api/v1/visits/{id}/story` (`getVisitStory`): what the phone renders the patient's video
 * from. It carries no name, phone, link or PIN, and the same refusals as Send apply (409). Raw JSON
 * for the story WebView.
 */
suspend fun ClinicApi.visitStory(visitId: String): Outcome<JsonObject, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/visits/${visitId.encodeURLPathPart()}/story")
    }
