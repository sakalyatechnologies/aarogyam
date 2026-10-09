package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Availability
import com.aarogyam.staff.api.model.NewAppointmentBody
import com.aarogyam.staff.api.model.SavedAppointment
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import kotlinx.datetime.LocalDate

/** `GET /api/v1/public/availability` (`getAvailability`): [practitionerId]'s free slots on [date]. */
suspend fun ClinicApi.availability(
    date: LocalDate,
    practitionerId: String,
): Outcome<Availability, ApiError> =
    client.call {
        url("api/v1/public/availability")
        parameter("date", date.toString())
        parameter("practitioner_id", practitionerId)
    }

/**
 * `POST /api/v1/appointments` (`createAppointment`): books a visit. No idempotency key exists, so it
 * is never retried automatically; a double tap is blocked by the holder.
 */
suspend fun ClinicApi.book(body: NewAppointmentBody): Outcome<SavedAppointment, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/appointments")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
