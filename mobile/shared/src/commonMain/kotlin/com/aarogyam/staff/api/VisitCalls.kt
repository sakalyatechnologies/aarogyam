package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.HandOff
import com.aarogyam.staff.api.model.MessagePrefs
import com.aarogyam.staff.api.model.MessagePreview
import com.aarogyam.staff.api.model.NewPatientMessage
import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.api.model.Procedure
import com.aarogyam.staff.api.model.ProcedureList
import com.aarogyam.staff.api.model.ShareRequest
import com.aarogyam.staff.api.model.VisitDetail
import com.aarogyam.staff.api.model.VisitLink
import com.aarogyam.staff.api.model.VisitPatientMessage
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

/** `POST /api/v1/procedures/{id}/complete` (`completeProcedure`): a planned procedure is done; its plan item follows. */
suspend fun ClinicApi.completeProcedure(id: String): Outcome<Procedure, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/procedures/${id.encodeURLPathPart()}/complete")
    }

/** `GET /api/v1/visits/{id}` (`getVisit`): one visit with its notes, procedures, chart entries, observations and files. */
suspend fun ClinicApi.visit(id: String): Outcome<VisitDetail, ApiError> =
    client.call { url("api/v1/visits/${id.encodeURLPathPart()}") }

/** `GET /api/v1/patients/{id}/procedures` (`listProcedures`): every procedure of the patient, newest first (`clinical.read`). */
suspend fun ClinicApi.patientProcedures(id: String): Outcome<ProcedureList, ApiError> =
    client.call { url("api/v1/patients/${id.encodeURLPathPart()}/procedures") }

/**
 * `POST /api/v1/visits/{id}/share` (`createVisitShare`): a seven-day link to the visit summary and
 * its PIN, shown once. The patient opens `/shared/{token}` on the clinic's host.
 */
suspend fun ClinicApi.shareVisit(visitId: String): Outcome<VisitLink, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/share")
        contentType(ContentType.Application.Json)
        setBody(ShareRequest(channel = "link"))
    }

/**
 * `POST /api/v1/visits/{id}/patient-message` (`prepareVisitPatientMessage`, clinical.read and
 * patients.contact): the patient's visit summary for the doctor's own WhatsApp. `no-store`: keep it
 * in memory only, never store, queue, retry or log it.
 */
suspend fun ClinicApi.prepareVisitPatientMessage(
    visitId: String,
    sections: List<String>? = null,
): Outcome<VisitPatientMessage, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/patient-message")
        // Ticks are saved as the doctor's defaults; no body asks for every section and saves nothing.
        if (sections != null) {
            contentType(ContentType.Application.Json)
            setBody(NewPatientMessage(sections = sections))
        }
    }

/**
 * `POST /api/v1/visits/{id}/patient-message/preview` (`previewVisitPatientMessage`): the summary as
 * Send would build it, with stand-ins for the link and PIN. Mints, saves and sends nothing; the text
 * stays in memory only.
 */
suspend fun ClinicApi.previewVisitPatientMessage(
    visitId: String,
    sections: List<String>,
): Outcome<MessagePreview, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/patient-message/preview")
        contentType(ContentType.Application.Json)
        setBody(NewPatientMessage(sections = sections))
    }

/** `POST /api/v1/visits/{id}/patient-message/handed-off` (204): counts a hand-off to WhatsApp, not a send. */
suspend fun ClinicApi.handOffVisitPatientMessage(
    visitId: String,
    templateVersion: String,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/visits/${visitId.encodeURLPathPart()}/patient-message/handed-off")
        contentType(ContentType.Application.Json)
        setBody(HandOff(templateVersion = templateVersion))
    }

/** `GET /api/v1/me/message-prefs`: the caller's default ticks in this clinic. */
suspend fun ClinicApi.messagePrefs(): Outcome<MessagePrefs, ApiError> = client.call { url("api/v1/me/message-prefs") }
