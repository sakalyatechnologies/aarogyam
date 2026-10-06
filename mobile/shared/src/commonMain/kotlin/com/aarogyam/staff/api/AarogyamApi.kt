package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AppointmentList
import com.aarogyam.staff.api.model.ClinicalFlags
import com.aarogyam.staff.api.model.Me
import com.aarogyam.staff.api.model.Patient
import com.aarogyam.staff.api.model.PatientList
import com.aarogyam.staff.api.model.PractitionerList
import com.aarogyam.staff.api.model.RoomList
import com.aarogyam.staff.api.model.SearchRequest
import com.aarogyam.staff.api.model.Session
import com.aarogyam.staff.api.model.TodayResponse
import com.aarogyam.staff.api.model.VisitList
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.HttpClient
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
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
    private val client: HttpClient,
) {
    /** `GET /api/v1/session` (`getSession`): clinic, branding, time zone and permissions. */
    suspend fun session(): Outcome<Session, ApiError> = client.call { url("api/v1/session") }

    /** `GET /api/v1/today` (`getToday`): everything the Today screen shows, in one request. */
    suspend fun today(): Outcome<TodayResponse, ApiError> = client.call { url("api/v1/today") }

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
            contentType(ContentType.Application.Json)
            setBody(SearchRequest(q = query, limit = limit))
        }

    /** `GET /api/v1/patients/{id}` (`getPatient`): the record; every open is audited server-side. */
    suspend fun patient(id: String): Outcome<Patient, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}") }

    /** `GET /api/v1/patients/{id}/clinical-flags` (`getClinicalFlags`): the allergy and condition banner. */
    suspend fun clinicalFlags(id: String): Outcome<ClinicalFlags, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}/clinical-flags") }

    /** `GET /api/v1/patients/{id}/visits` (`listVisits`): newest first. */
    suspend fun visits(id: String): Outcome<VisitList, ApiError> =
        client.call { url("api/v1/patients/${id.encodeURLPathPart()}/visits") }

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

    private companion object {
        const val SEARCH_LIMIT = 20L
    }
}
