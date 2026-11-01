package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.MissedList
import com.aarogyam.staff.api.model.ToCollectList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.url
import io.ktor.http.HttpMethod

/** `GET /api/v1/appointments/missed` (`listMissedAppointments`): no-shows of one `YYYY-MM-DD` day; the server defaults to today. */
suspend fun ClinicApi.missedAppointments(date: String? = null): Outcome<MissedList, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/appointments/missed")
        if (date != null) parameter("date", date)
    }

/** `GET /api/v1/queue/to-collect` (`listQueueToCollect`): bills from earlier days still to collect, oldest first. */
suspend fun ClinicApi.toCollect(): Outcome<ToCollectList, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/queue/to-collect")
    }
