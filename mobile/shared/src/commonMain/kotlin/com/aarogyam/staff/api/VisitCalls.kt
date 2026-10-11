package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.api.model.Procedure
import com.aarogyam.staff.api.model.ProcedureList
import com.aarogyam.staff.api.model.VisitDetail
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

/** `GET /api/v1/visits/{id}` (`getVisit`): one visit with its notes, procedures, chart entries, observations and files. */
suspend fun ClinicApi.visit(id: String): Outcome<VisitDetail, ApiError> =
    client.call { url("api/v1/visits/${id.encodeURLPathPart()}") }

/** `GET /api/v1/patients/{id}/procedures` (`listProcedures`): every procedure of the patient, newest first (`clinical.read`). */
suspend fun ClinicApi.patientProcedures(id: String): Outcome<ProcedureList, ApiError> =
    client.call { url("api/v1/patients/${id.encodeURLPathPart()}/procedures") }
