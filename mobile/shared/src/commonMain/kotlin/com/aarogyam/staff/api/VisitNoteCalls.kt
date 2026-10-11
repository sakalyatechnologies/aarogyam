package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.CloseVisit
import com.aarogyam.staff.api.model.NewNote
import com.aarogyam.staff.api.model.NewVisit
import com.aarogyam.staff.api.model.Note
import com.aarogyam.staff.api.model.NoteContent
import com.aarogyam.staff.api.model.Visit
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `POST /api/v1/patients/{id}/visits` (`startVisit`): a visit for a patient without a queue token; the client id makes a retry safe. */
suspend fun ClinicApi.startVisit(
    patientId: String,
    visit: NewVisit,
): Outcome<Visit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/visits")
        contentType(ContentType.Application.Json)
        setBody(visit)
    }

/** `POST /api/v1/visits/{id}/notes` (`createNote`): the visit's note, created once with a client id. */
suspend fun ClinicApi.createNote(
    visitId: String,
    note: NewNote,
): Outcome<Note, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/notes")
        contentType(ContentType.Application.Json)
        setBody(note)
    }

/** `PATCH /api/v1/notes/{id}` (`editNote`): a draft's new sections, guarded by its [rowVersion]. */
suspend fun ClinicApi.editNote(
    noteId: String,
    rowVersion: Long,
    content: NoteContent,
): Outcome<Note, ApiError> =
    client.call {
        method = HttpMethod.Patch
        url("api/v1/notes/${noteId.encodeURLPathPart()}")
        header("If-Match", "\"$rowVersion\"")
        contentType(ContentType.Application.Json)
        setBody(content)
    }

/** `POST /api/v1/notes/{id}/sign` (`signNote`): signs the draft; it can then only take addenda. */
suspend fun ClinicApi.signNote(noteId: String): Outcome<Note, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/notes/${noteId.encodeURLPathPart()}/sign")
    }

/**
 * `POST /api/v1/visits/{id}/close` (`closeVisit`). The optional [body] plans a follow-up (needs
 * `patients.write`) and starts a draft bill from a consultation fee (needs `billing.write`); the
 * answer is the visit plus `recall_id` and `invoice_id`. An empty close sends no body.
 */
suspend fun ClinicApi.closeVisit(
    visitId: String,
    body: CloseVisit? = null,
): Outcome<Visit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/close")
        if (body != null) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
    }
