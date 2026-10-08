package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AppointmentList
import com.aarogyam.staff.api.model.Attachment
import com.aarogyam.staff.api.model.AttachmentList
import com.aarogyam.staff.api.model.ClinicalFlags
import com.aarogyam.staff.api.model.DentalChart
import com.aarogyam.staff.api.model.DentalTerm
import com.aarogyam.staff.api.model.DownloadLink
import com.aarogyam.staff.api.model.DrugList
import com.aarogyam.staff.api.model.DrugSearch
import com.aarogyam.staff.api.model.InvoiceList
import com.aarogyam.staff.api.model.IssueBlocked
import com.aarogyam.staff.api.model.IssueRequest
import com.aarogyam.staff.api.model.Me
import com.aarogyam.staff.api.model.NewChartEntries
import com.aarogyam.staff.api.model.NewDentalTerm
import com.aarogyam.staff.api.model.NewPayment
import com.aarogyam.staff.api.model.Patient
import com.aarogyam.staff.api.model.PatientList
import com.aarogyam.staff.api.model.PatientNotes
import com.aarogyam.staff.api.model.Payment
import com.aarogyam.staff.api.model.PractitionerList
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.PrescriptionList
import com.aarogyam.staff.api.model.RoomList
import com.aarogyam.staff.api.model.RxValues
import com.aarogyam.staff.api.model.SearchRequest
import com.aarogyam.staff.api.model.Session
import com.aarogyam.staff.api.model.ShareLink
import com.aarogyam.staff.api.model.SummaryContent
import com.aarogyam.staff.api.model.SummaryNote
import com.aarogyam.staff.api.model.TodayMoney
import com.aarogyam.staff.api.model.TodayResponse
import com.aarogyam.staff.api.model.VisitList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.BodyFailure
import com.sakalya.mobile.http.call
import com.sakalya.mobile.http.callWithErrorBody
import com.sakalya.mobile.http.idempotencyKey
import io.ktor.client.HttpClient
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** Calls on the app host, which knows the person but no clinic. */
class AppApi(
    private val client: HttpClient,
) {
    /** `GET /api/v1/me` (`getMe`): the clinics the person belongs to, with their hosts. */
    suspend fun me(): Outcome<Me, ApiError> = client.call { url("api/v1/me") }
}

/** Calls on one clinic's host; the host alone selects the clinic. */
class ClinicApi(
    internal val client: HttpClient,
    /** The clinic's origin (`https://host`), the base of links the patient opens. */
    val origin: String = "",
) {
    /** `GET /api/v1/session` (`getSession`): clinic, branding, time zone and permissions. */
    suspend fun session(): Outcome<Session, ApiError> = client.call { url("api/v1/session") }

    /** `GET /api/v1/today` (`getToday`): everything the Today screen shows, in one request. */
    suspend fun today(): Outcome<TodayResponse, ApiError> = client.call { url("api/v1/today") }

    /** `GET /api/v1/today/money` (`getTodayMoney`): the money tiles, in one request; needs `finance.view`. */
    suspend fun todayMoney(): Outcome<TodayMoney, ApiError> = client.call { url("api/v1/today/money") }

    /** `GET /api/v1/invoices?patient_id=` (`listInvoices`): the patient's bills, newest first, without lines. */
    suspend fun invoices(patientId: String): Outcome<InvoiceList, ApiError> =
        client.call {
            url("api/v1/invoices")
            parameter("patient_id", patientId)
            parameter("limit", INVOICE_LIMIT)
        }

    /**
     * `POST /api/v1/payments` (`recordPayment`): sends [key] as the `Idempotency-Key`, so a retry of
     * the same submission returns the first payment (200) instead of recording another (201).
     */
    suspend fun recordPayment(
        payment: NewPayment,
        key: IdempotencyKey,
    ): Outcome<Payment, ApiError> =
        client.call {
            method = HttpMethod.Post
            url("api/v1/payments")
            idempotencyKey(key)
            contentType(ContentType.Application.Json)
            setBody(payment)
        }

    /**
     * `POST /api/v1/patients/search` (`searchPatients`): by number, phone or the start of a name.
     * The terms travel in the body, never the URL. An empty [query] lists the newest patients.
     */
    suspend fun searchPatients(
        query: String,
        limit: Long = SEARCH_LIMIT,
    ): Outcome<PatientList, ApiError> =
        client.call {
            url("api/v1/patients/search")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(SearchRequest(q = query, limit = limit))
        }

    /** `GET /api/v1/patients/{id}` (`getPatient`): the record; every open is audited server-side. */
    suspend fun patient(id: String): Outcome<Patient, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}") }

    /** `GET /api/v1/patients/{id}/clinical-flags` (`getClinicalFlags`): the allergy and condition banner. */
    suspend fun clinicalFlags(id: String): Outcome<ClinicalFlags, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}/clinical-flags") }

    /** `GET /api/v1/patients/{id}/attachments` (`listAttachments`): the patient's files, newest first; needs `clinical.read`. */
    suspend fun attachments(patientId: String): Outcome<AttachmentList, ApiError> =
        client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/attachments") }

    /**
     * `POST /api/v1/patients/{id}/attachments` (`uploadAttachment`): a JPEG already resized on the
     * device, with its optional [label] and FDI [tooth]. [id] is the client's UUID v7, so a retry
     * returns the stored file instead of making another. The file goes through the API, never to a
     * bucket address, and carries a fixed name: nothing about the patient is in the form.
     */
    suspend fun uploadAttachment(
        patientId: String,
        id: String,
        kind: String,
        jpeg: ByteArray,
        label: String?,
        tooth: Int?,
    ): Outcome<Attachment, ApiError> =
        client.call {
            method = HttpMethod.Post
            url("api/v1/patients/${patientId.encodeURLPathPart()}/attachments")
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append("id", id)
                        append("kind", kind)
                        if (label != null) append("label", label)
                        if (tooth != null) append("tooth", tooth.toString())
                        append(
                            "file",
                            jpeg,
                            Headers.build {
                                append(HttpHeaders.ContentType, "image/jpeg")
                                append(HttpHeaders.ContentDisposition, "filename=\"photo.jpg\"")
                            },
                        )
                    },
                ),
            )
        }

    /**
     * A file's bytes: asks `GET /api/v1/attachments/{id}/download` for a five-minute link, then
     * opens it on the same clinic host (the link is the proof of access).
     */
    suspend fun attachmentBytes(id: String): Outcome<ByteArray, ApiError> =
        when (val link = client.call<DownloadLink> { url("api/v1/attachments/${id.encodeURLPathPart()}/download") }) {
            is Outcome.Failure -> link
            is Outcome.Success -> client.call { url(link.value.url.trimStart('/')) }
        }

    /** `GET /api/v1/patients/{id}/visits` (`listVisits`): newest first. */
    suspend fun visits(id: String): Outcome<VisitList, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}/visits") }

    /** `GET /api/v1/patients/{id}/notes` (`getPatientNotes`): the summary note and the visit notes, newest first. */
    suspend fun patientNotes(id: String): Outcome<PatientNotes, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}/notes") }

    /**
     * `PUT /api/v1/patients/{id}/summary-note` (`savePatientSummaryNote`): saves the summary note. With
     * [expectedVersion] (the `row_version` the editor started from) the API refuses with 412 when the note
     * changed since; null for the first save.
     */
    suspend fun saveSummaryNote(
        id: String,
        body: String,
        expectedVersion: Long?,
    ): Outcome<SummaryNote, ApiError> =
        client.call {
            method = HttpMethod.Put
            url("api/v1/patients/${id.encodeURLPathPart()}/summary-note")
            if (expectedVersion != null) header("If-Match", "\"$expectedVersion\"")
            contentType(ContentType.Application.Json)
            setBody(SummaryContent(body = body))
        }

    /**
     * `GET /api/v1/patients/{id}/dental-chart` (`getDentalChart`): every tooth's current findings in
     * one request, plus the full history of [tooth] when given.
     */
    suspend fun dentalChart(
        id: String,
        tooth: Int? = null,
    ): Outcome<DentalChart, ApiError> =
        client.call {
            url("api/v1/patients/${id.encodeURLPathPart()}/dental-chart")
            if (tooth != null) parameter("tooth", tooth)
        }

    /** `POST /api/v1/patients/{id}/dental-chart` (`recordDentalChart`): records findings, returns the updated chart. */
    suspend fun recordDentalChart(
        id: String,
        entries: NewChartEntries,
    ): Outcome<DentalChart, ApiError> =
        client.call {
            method = HttpMethod.Post
            url("api/v1/patients/${id.encodeURLPathPart()}/dental-chart")
            contentType(ContentType.Application.Json)
            setBody(entries)
        }

    /**
     * `POST /api/v1/dental-terms` (`addDentalTerm`): adds a procedure or material for the clinic;
     * a label already there (or seeded) returns that term.
     */
    suspend fun addDentalTerm(term: NewDentalTerm): Outcome<DentalTerm, ApiError> =
        client.call {
            method = HttpMethod.Post
            url("api/v1/dental-terms")
            contentType(ContentType.Application.Json)
            setBody(term)
        }

    /** `GET /api/v1/appointments` (`listAppointments`): the clinic's local days [from] to [to] (`YYYY-MM-DD`). */
    suspend fun appointments(
        from: String,
        to: String,
    ): Outcome<AppointmentList, ApiError> =
        client.call {
            url("api/v1/appointments")
            parameter("from", from)
            parameter("to", to)
        }

    /** `GET /api/v1/practitioners` (`listPractitioners`): reference data, cached by [ReferenceData]. */
    suspend fun practitioners(): Outcome<PractitionerList, ApiError> = client.call { url("api/v1/practitioners") }

    /** `GET /api/v1/rooms` (`listRooms`): reference data, cached by [ReferenceData]. */
    suspend fun rooms(): Outcome<RoomList, ApiError> = client.call { url("api/v1/rooms") }

    /** `GET /api/v1/patients/{id}/prescriptions` (`listPatientPrescriptions`): newest first; needs `clinical.read`. */
    suspend fun prescriptions(patientId: String): Outcome<PrescriptionList, ApiError> =
        client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/prescriptions") }

    /** `GET /api/v1/patients/{id}/prescriptions/last` (`getLastPrescription`): the last issued one, for Quick Rx. */
    suspend fun lastPrescription(patientId: String): Outcome<Prescription, ApiError> =
        client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/prescriptions/last") }

    /** `POST /api/v1/drugs/search` (`searchDrugs`): the shared medicine list; the terms travel in the body. */
    suspend fun searchDrugs(
        query: String,
        limit: Long = DRUG_LIMIT,
    ): Outcome<DrugList, ApiError> =
        client.call {
            url("api/v1/drugs/search")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(DrugSearch(q = query, limit = limit))
        }

    /** `POST /api/v1/patients/{id}/prescriptions` (`createPrescription`): a draft with its medicines. */
    suspend fun createPrescription(
        patientId: String,
        values: RxValues,
    ): Outcome<Prescription, ApiError> =
        client.call {
            url("api/v1/patients/${patientId.encodeURLPathPart()}/prescriptions")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(values)
        }

    /**
     * `POST /api/v1/prescriptions/{id}/issue` (`issuePrescription`). Without an [overrideReason] an
     * allergy alert answers 409 with its own body (`IssueBlocked`, not the standard error
     * envelope); it comes back as [BodyFailure.body] next to the `Conflict` error. The patient is
     * not emailed: the app shares the link itself.
     */
    suspend fun issuePrescription(
        id: String,
        overrideReason: String?,
    ): Outcome<Prescription, BodyFailure<IssueBlocked>> =
        client.callWithErrorBody(HttpStatusCode.Conflict.value) {
            url("api/v1/prescriptions/${id.encodeURLPathPart()}/issue")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(IssueRequest(notifyPatient = false, overrideReason = overrideReason))
        }

    /** `POST /api/v1/prescriptions/{id}/share` (`createPrescriptionShare`): a seven-day link and its PIN, shown once. */
    suspend fun sharePrescription(id: String): Outcome<ShareLink, ApiError> =
        client.call {
            url("api/v1/prescriptions/${id.encodeURLPathPart()}/share")
            method = HttpMethod.Post
        }

    private companion object {
        const val SEARCH_LIMIT = 20L
        const val DRUG_LIMIT = 20L
        const val INVOICE_LIMIT = 50L
    }
}
