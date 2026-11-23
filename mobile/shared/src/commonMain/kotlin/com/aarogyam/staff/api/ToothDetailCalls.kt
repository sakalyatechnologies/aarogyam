package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.DetailInError
import com.aarogyam.staff.api.model.NewToothEruption
import com.aarogyam.staff.api.model.ToothCondition
import com.aarogyam.staff.api.model.ToothEruption
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

/** Which detail row of a tooth: its condition or its eruption. */
enum class ToothDetailKind(
    internal val path: String,
) {
    Condition("condition"),
    Eruption("eruption"),
}

/**
 * `PUT /api/v1/patients/{id}/dental-chart/teeth/{tooth}/condition` (`setToothCondition`): merges
 * [change] onto the tooth's condition; an omitted field keeps its value and `null` clears it. Built
 * as a JSON object because the client's encoder drops nulls from generated models.
 */
suspend fun ClinicApi.setToothCondition(
    patientId: String,
    tooth: Int,
    change: JsonObject,
): Outcome<ToothCondition, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/condition")
        contentType(ContentType.Application.Json)
        setBody(change)
    }

/** `PUT /api/v1/patients/{id}/dental-chart/teeth/{tooth}/eruption` (`setToothEruption`): a permanent tooth's eruption. */
suspend fun ClinicApi.setToothEruption(
    patientId: String,
    tooth: Int,
    body: NewToothEruption,
): Outcome<ToothEruption, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/eruption")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST …/teeth/{tooth}/{condition|eruption}/entered-in-error` (204): the current row was recorded by mistake. */
suspend fun ClinicApi.toothDetailInError(
    patientId: String,
    tooth: Int,
    kind: ToothDetailKind,
    reason: String,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/${kind.path}/entered-in-error")
        contentType(ContentType.Application.Json)
        setBody(DetailInError(reason = reason))
    }
