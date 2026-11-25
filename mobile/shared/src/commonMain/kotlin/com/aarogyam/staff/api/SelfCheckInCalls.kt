package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AcceptBody
import com.aarogyam.staff.api.model.ArrivalList
import com.aarogyam.staff.api.model.Pincode
import com.aarogyam.staff.api.model.SelfCheckInSettings
import com.aarogyam.staff.api.model.SelfCheckInSwitch
import com.aarogyam.staff.api.model.WalkIn
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/arrivals` (`listArrivals`, patients.read): QR check-ins waiting for the desk, oldest first. */
suspend fun ClinicApi.arrivals(): Outcome<ArrivalList, ApiError> = client.call { url("api/v1/arrivals") }

/**
 * `POST /api/v1/arrivals/{id}/accept` (`acceptArrival`): registers (or picks) the patient and
 * checks them in. 409 `already_handled` when someone else got there first.
 */
suspend fun ClinicApi.acceptArrival(
    id: String,
    body: AcceptBody,
): Outcome<WalkIn, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/arrivals/${id.encodeURLPathPart()}/accept")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST /api/v1/arrivals/{id}/dismiss` (`dismissArrival`): drops the request; 409 `already_handled`. */
suspend fun ClinicApi.dismissArrival(id: String): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/arrivals/${id.encodeURLPathPart()}/dismiss")
    }

/** `GET /api/v1/settings/self-check-in` (`getSelfCheckInSettings`, settings.manage). */
suspend fun ClinicApi.selfCheckIn(): Outcome<SelfCheckInSettings, ApiError> =
    client.call {
        url("api/v1/settings/self-check-in")
    }

/** `PUT /api/v1/settings/self-check-in` (`setSelfCheckIn`): the switch; turning it on makes the first QR. */
suspend fun ClinicApi.setSelfCheckIn(enabled: Boolean): Outcome<SelfCheckInSettings, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/settings/self-check-in")
        contentType(ContentType.Application.Json)
        setBody(SelfCheckInSwitch(enabled = enabled))
    }

/** `POST /api/v1/settings/self-check-in/key` (`newSelfCheckInKey`): a new link; the old QR stops working. */
suspend fun ClinicApi.newSelfCheckInKey(): Outcome<SelfCheckInSettings, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/settings/self-check-in/key")
    }

/** `GET /api/v1/public/pincodes/{pin}` (`lookupPincode`): the district and state of a six-digit PIN. */
suspend fun ClinicApi.pincode(pin: String): Outcome<Pincode, ApiError> =
    client.call { url("api/v1/public/pincodes/${pin.encodeURLPathPart()}") }
