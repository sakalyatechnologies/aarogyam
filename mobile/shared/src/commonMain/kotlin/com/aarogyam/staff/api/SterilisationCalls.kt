package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewSterilisationCycle
import com.aarogyam.staff.api.model.SterilisationCycle
import com.aarogyam.staff.api.model.SterilisationCycleList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType

/** `GET /api/v1/sterilisation-cycles` (`listSterilisationCycles`): today's autoclave runs, latest first (needs `tasks.use`). */
suspend fun ClinicApi.sterilisationCycles(): Outcome<SterilisationCycleList, ApiError> =
    client.call { url("api/v1/sterilisation-cycles") }

/** `POST /api/v1/sterilisation-cycles` (`recordSterilisationCycle`): a cycle that ran now (needs `tasks.use`). */
suspend fun ClinicApi.recordSterilisationCycle(body: NewSterilisationCycle): Outcome<SterilisationCycle, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/sterilisation-cycles")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
