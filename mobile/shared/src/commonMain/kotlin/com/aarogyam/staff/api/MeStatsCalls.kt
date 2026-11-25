package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.MyStats
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.url

/** `GET /api/v1/me/stats` (`getMyStats`): the caller's own figures for today; needs `clinical.read`. */
suspend fun ClinicApi.myStats(): Outcome<MyStats, ApiError> = client.call { url("api/v1/me/stats") }
