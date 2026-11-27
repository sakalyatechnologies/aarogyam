package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewToothNote
import com.aarogyam.staff.api.model.ToothNote
import com.aarogyam.staff.api.model.ToothNoteList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `POST /api/v1/patients/{id}/dental-chart/teeth/{tooth}/notes` (`addToothNote`, clinical.write): a retry with the same client id returns the same note. */
suspend fun ClinicApi.addToothNote(
    patientId: String,
    tooth: Int,
    body: NewToothNote,
): Outcome<ToothNote, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/notes")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `GET /api/v1/patients/{id}/dental-chart/teeth/{tooth}/notes` (`listToothNotes`, clinical.read): newest first, at most 50. */
suspend fun ClinicApi.toothNotes(
    patientId: String,
    tooth: Int,
): Outcome<ToothNoteList, ApiError> =
    client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/dental-chart/teeth/$tooth/notes") }
