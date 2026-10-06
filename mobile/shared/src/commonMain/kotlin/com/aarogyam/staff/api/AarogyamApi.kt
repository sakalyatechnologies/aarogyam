package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Me
import com.aarogyam.staff.api.model.Session
import com.aarogyam.staff.api.model.TodayResponse
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.HttpClient
import io.ktor.client.request.url

/** Calls on the app host, which knows the person but no clinic. */
class AppApi(
    private val client: HttpClient,
) {
    /** `GET /api/v1/me` (`getMe`): the clinics the person belongs to, with their hosts. */
    suspend fun me(): Outcome<Me, ApiError> = client.call { url("api/v1/me") }
}

/** Calls on one clinic's host; the host alone selects the clinic. */
class ClinicApi(
    private val client: HttpClient,
) {
    /** `GET /api/v1/session` (`getSession`): clinic, branding, time zone and permissions. */
    suspend fun session(): Outcome<Session, ApiError> = client.call { url("api/v1/session") }

    /** `GET /api/v1/today` (`getToday`): everything the Today screen shows, in one request. */
    suspend fun today(): Outcome<TodayResponse, ApiError> = client.call { url("api/v1/today") }
}
