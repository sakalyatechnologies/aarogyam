package com.aarogyam.staff.timeoff

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.NewTimeOff
import com.aarogyam.staff.api.model.TimeOff
import com.aarogyam.staff.api.model.TimeOffDecision
import com.aarogyam.staff.api.model.TimeOffList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/time-off` (`listTimeOff`): who is away from [from] to [to] (`YYYY-MM-DD`, at most 42 days), and the caller's own requests. */
internal suspend fun ClinicApi.listTimeOff(
    from: String,
    to: String,
): Outcome<TimeOffList, ApiError> =
    client.call {
        url("api/v1/time-off")
        parameter("from", from)
        parameter("to", to)
    }

/** `POST /api/v1/time-off` (`createTimeOff`): a request for the caller (no `membership_id`). */
internal suspend fun ClinicApi.requestTimeOff(body: NewTimeOff): Outcome<TimeOff, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/time-off")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST /api/v1/time-off/{id}/approve` (`approveTimeOff`); needs `time_off.manage`. */
internal suspend fun ClinicApi.approveTimeOff(
    id: String,
    note: String?,
): Outcome<TimeOff, ApiError> = decideTimeOff(id, "approve", note)

/** `POST /api/v1/time-off/{id}/decline` (`declineTimeOff`); needs `time_off.manage`. */
internal suspend fun ClinicApi.declineTimeOff(
    id: String,
    note: String?,
): Outcome<TimeOff, ApiError> = decideTimeOff(id, "decline", note)

private suspend fun ClinicApi.decideTimeOff(
    id: String,
    verb: String,
    note: String?,
): Outcome<TimeOff, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/time-off/${id.encodeURLPathPart()}/$verb")
        contentType(ContentType.Application.Json)
        setBody(TimeOffDecision(note = note))
    }

/** `POST /api/v1/time-off/{id}/cancel` (`cancelTimeOff`): the requester withdraws; no body. */
internal suspend fun ClinicApi.cancelTimeOff(id: String): Outcome<TimeOff, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/time-off/${id.encodeURLPathPart()}/cancel")
    }
