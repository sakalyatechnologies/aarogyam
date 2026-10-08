package com.aarogyam.patient.api

import com.aarogyam.patient.api.model.Availability
import com.aarogyam.patient.api.model.BookingOptions
import com.aarogyam.patient.api.model.LinkedByCode
import com.aarogyam.patient.api.model.NewLinkRequest
import com.aarogyam.patient.api.model.PatientAppointment
import com.aarogyam.patient.api.model.PatientAppointments
import com.aarogyam.patient.api.model.PatientBills
import com.aarogyam.patient.api.model.PatientBooking
import com.aarogyam.patient.api.model.PatientCancelled
import com.aarogyam.patient.api.model.PatientHome
import com.aarogyam.patient.api.model.PatientMe
import com.aarogyam.patient.api.model.PatientPrescriptions
import com.aarogyam.patient.api.model.RedeemLinkCode
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.core.map
import com.sakalya.mobile.http.call
import io.ktor.client.HttpClient
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/**
 * The patient's own records on the app host: every linked clinic at once, one request per
 * screen. The person never names a clinic here; the API reads the clinics that linked them.
 */
class PatientAppApi(
    private val client: HttpClient,
) {
    /** `GET /api/v1/me/patient` (`getMyPatientAccount`): the account and its linked clinics. */
    suspend fun me(): Outcome<PatientMe, ApiError> = client.call { url("api/v1/me/patient") }

    /** `GET /api/v1/me/patient/home` (`getMyPatientHome`): the home screen in one request. */
    suspend fun home(): Outcome<PatientHome, ApiError> = client.call { url("api/v1/me/patient/home") }

    /** `GET /api/v1/me/patient/appointments` (`listMyAppointments`). */
    suspend fun appointments(): Outcome<PatientAppointments, ApiError> =
        client.call {
            url("api/v1/me/patient/appointments")
        }

    /** `GET /api/v1/me/patient/prescriptions` (`listMyPrescriptions`): issued ones only. */
    suspend fun prescriptions(): Outcome<PatientPrescriptions, ApiError> =
        client.call {
            url("api/v1/me/patient/prescriptions")
        }

    /** `GET /api/v1/me/patient/bills` (`listMyBills`): issued bills and balances, read only. */
    suspend fun bills(): Outcome<PatientBills, ApiError> = client.call { url("api/v1/me/patient/bills") }

    /** `POST /api/v1/me/patient/links` (`redeemPatientLinkCode`): links a clinic with its code. */
    suspend fun redeem(code: String): Outcome<LinkedByCode, ApiError> =
        client.call {
            url("api/v1/me/patient/links")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(RedeemLinkCode(code = code))
        }

    /** `POST /api/v1/me/patient/link-requests` (`requestPatientLink`): asks a clinic to confirm; always `202`. */
    suspend fun requestLink(clinicSlug: String): Outcome<Unit, ApiError> =
        client
            .call<String> {
                url("api/v1/me/patient/link-requests")
                method = HttpMethod.Post
                contentType(ContentType.Application.Json)
                setBody(NewLinkRequest(clinic = clinicSlug))
            }.map { }
}

/** Calls on one linked clinic's own host: booking, cancelling (the host selects the clinic). */
class PatientClinicApi(
    private val client: HttpClient,
) {
    /** `GET /api/v1/public/booking` (`getBookingOptions`): the doctors patients may pick. */
    suspend fun bookingOptions(): Outcome<BookingOptions, ApiError> = client.call { url("api/v1/public/booking") }

    /** `GET /api/v1/public/availability` (`listFreeSlots`): a doctor's free slots on a day. */
    suspend fun availability(
        date: String,
        practitionerId: String,
    ): Outcome<Availability, ApiError> =
        client.call {
            url("api/v1/public/availability")
            parameter("date", date)
            parameter("practitioner_id", practitionerId)
        }

    /** `POST /api/v1/me/patient/bookings` (`bookAsPatient`): books an offered slot. */
    suspend fun book(booking: PatientBooking): Outcome<PatientAppointment, ApiError> =
        client.call {
            url("api/v1/me/patient/bookings")
            method = HttpMethod.Post
            contentType(ContentType.Application.Json)
            setBody(booking)
        }

    /** `POST /api/v1/me/patient/appointments/{id}/cancel` (`cancelMyAppointment`). */
    suspend fun cancel(appointmentId: String): Outcome<PatientCancelled, ApiError> =
        client.call {
            url("api/v1/me/patient/appointments/${appointmentId.encodeURLPathPart()}/cancel")
            method = HttpMethod.Post
        }
}
