package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.api.model.Procedure
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `POST /api/v1/visits/{id}/procedures` (`addProcedure`): logs a done or planned procedure in a visit. */
suspend fun ClinicApi.addProcedure(
    visitId: String,
    procedure: NewProcedure,
): Outcome<Procedure, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/procedures")
        contentType(ContentType.Application.Json)
        setBody(procedure)
    }
