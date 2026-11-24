package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.SmileShade
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

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

/**
 * `GET /api/v1/visits/{id}/present` (`getVisitPresent`): the plan, comparisons and, for billing.read
 * with prices shown, `prices[]`, for Show patient. Raw JSON for the story WebView.
 */
suspend fun ClinicApi.visitPresent(visitId: String): Outcome<JsonObject, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/visits/${visitId.encodeURLPathPart()}/present")
    }

/** `GET /api/v1/me/ui-prefs`: the caller's own look choices (`present_style`, `history_view`), raw. */
suspend fun ClinicApi.uiPrefs(): Outcome<JsonObject, ApiError> = client.call { url("api/v1/me/ui-prefs") }

/** `PUT /api/v1/me/ui-prefs` with only `present_style`; fields left out stay as they are. */
suspend fun ClinicApi.savePresentStyle(style: String): Outcome<JsonObject, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/me/ui-prefs")
        contentType(ContentType.Application.Json)
        setBody(JsonObject(mapOf("present_style" to JsonPrimitive(style))))
    }

/** `GET /api/v1/patients/{id}/smile-shade`: the patient's saved tooth colour, 0 to 100, or null when never saved. */
suspend fun ClinicApi.smileShade(patientId: String): Outcome<SmileShade, ApiError> =
    client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/smile-shade") }

/** `PUT /api/v1/patients/{id}/smile-shade`: saves the tooth colour (0 to 100, clinical.write). */
suspend fun ClinicApi.saveSmileShade(
    patientId: String,
    shade: Int,
): Outcome<SmileShade, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${patientId.encodeURLPathPart()}/smile-shade")
        contentType(ContentType.Application.Json)
        setBody(SmileShade(shade = shade))
    }
