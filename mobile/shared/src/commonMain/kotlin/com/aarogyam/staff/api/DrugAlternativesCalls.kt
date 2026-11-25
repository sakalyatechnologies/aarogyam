package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Drug
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.url
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/drugs/{id}/alternatives` (`drugAlternatives`): same generic, strength and form; needs `prescriptions.issue`. */
suspend fun ClinicApi.drugAlternatives(id: String): Outcome<List<Drug>, ApiError> =
    client.call { url("api/v1/drugs/${id.encodeURLPathPart()}/alternatives") }
