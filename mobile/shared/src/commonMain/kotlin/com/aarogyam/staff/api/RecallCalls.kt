package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewRecall
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.Recall
import com.aarogyam.staff.api.model.RecallList
import com.aarogyam.staff.api.model.RxValues
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/recalls` (`listRecallsDue`): open follow-ups, soonest first. There is no per-patient route. */
suspend fun ClinicApi.listRecalls(): Outcome<RecallList, ApiError> =
    client.call {
        method = HttpMethod.Get
        url("api/v1/recalls")
    }

/** `POST /api/v1/patients/{id}/recalls` (`createRecall`). */
suspend fun ClinicApi.createRecall(
    patientId: String,
    recall: NewRecall,
): Outcome<Recall, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/recalls")
        contentType(ContentType.Application.Json)
        setBody(recall)
    }

/** `PATCH /api/v1/prescriptions/{id}` (`updatePrescription`): edits a draft; `items` replaces every medicine. */
suspend fun ClinicApi.updatePrescription(
    id: String,
    values: RxValues,
): Outcome<Prescription, ApiError> =
    client.call {
        method = HttpMethod.Patch
        url("api/v1/prescriptions/${id.encodeURLPathPart()}")
        contentType(ContentType.Application.Json)
        setBody(values)
    }
