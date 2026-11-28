package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.MoveRequest
import com.aarogyam.staff.api.model.StatusChange
import com.aarogyam.staff.api.model.StatusChanged
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
 * `POST /api/v1/appointments/{id}/status` (`setAppointmentStatus`, appointments.write). Asking for the
 * status it already has changes nothing, so a retry is safe. 409 `slot_occupied` when confirming into
 * a taken time without `double_book`.
 */
suspend fun ClinicApi.setStatus(
    id: String,
    body: StatusChange,
): Outcome<StatusChanged, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/appointments/${id.encodeURLPathPart()}/status")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST /api/v1/appointments/{id}/move` (`moveAppointment`): reschedules and confirms; keeps the length. */
suspend fun ClinicApi.move(
    id: String,
    body: MoveRequest,
): Outcome<StatusChanged, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/appointments/${id.encodeURLPathPart()}/move")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
