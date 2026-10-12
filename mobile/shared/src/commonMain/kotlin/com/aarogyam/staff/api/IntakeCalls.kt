package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.PhoneLookup
import com.aarogyam.staff.api.model.QueueDay
import com.aarogyam.staff.api.model.QueueToken
import com.aarogyam.staff.api.model.QuickPicks
import com.aarogyam.staff.api.model.StartedVisit
import com.aarogyam.staff.api.model.TokenStatusChange
import com.aarogyam.staff.api.model.WalkIn
import com.aarogyam.staff.api.model.WalkInRequest
import com.aarogyam.staff.config.caps.FamilyOfBody
import com.aarogyam.staff.config.caps.PhoneMatchesFamily
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.config.caps.capsJson
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * `POST /api/v1/patients/lookup` (`lookupPatientsByPhone`): registered patients with [phone].
 * The phone travels in the body, never the URL.
 */
suspend fun ClinicApi.lookupByPhone(phone: String): Outcome<PhoneMatchesFamily, ApiError> {
    val answer: Outcome<PhoneMatchesFamily, ApiError> =
        client.call {
            method = HttpMethod.Post
            url("api/v1/patients/lookup")
            contentType(ContentType.Application.Json)
            setBody(PhoneLookup(phone = phone))
        }
    // `family_group` in a real answer is what turns the family features on.
    if (answer is Outcome.Success && answer.value.familyGroup != null) ServerCaps.markFamily()
    return answer
}

/**
 * `POST /api/v1/walk-ins` (`registerWalkIn`): registers (or picks) the patient, records the
 * patient-reported allergies and desk consents, and issues a queue token, in one request.
 */
suspend fun ClinicApi.registerWalkIn(
    request: WalkInRequest,
    familyOf: FamilyOfBody? = null,
): Outcome<WalkIn, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/walk-ins")
        contentType(ContentType.Application.Json)
        if (familyOf != null && ServerCaps.family) {
            // `family_of` is not in main's models: it travels beside them, only while the flag is on.
            val body = capsJson.encodeToJsonElement(WalkInRequest.serializer(), request).jsonObject
            setBody(
                JsonObject(body + ("family_of" to capsJson.encodeToJsonElement(FamilyOfBody.serializer(), familyOf))),
            )
        } else {
            setBody(request)
        }
    }

/**
 * `GET /api/v1/queue` (`listQueue`): today's tokens by branch and number; with [practitionerId]
 * only that doctor's tokens ("My patients").
 */
suspend fun ClinicApi.queue(practitionerId: String? = null): Outcome<QueueDay, ApiError> =
    client.call {
        url("api/v1/queue")
        if (practitionerId != null) parameter("practitioner_id", practitionerId)
    }

/**
 * `POST /api/v1/queue/{id}/call` (`callQueueToken`): the doctor sends a waiting patient in
 * (`waiting` to `called`; clinical.write). A repeat is a no-op; a token in another state is 409.
 */
suspend fun ClinicApi.callToken(id: String): Outcome<QueueToken, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/queue/${id.encodeURLPathPart()}/call")
    }

/** `POST /api/v1/queue/{id}/status` (`setQueueTokenStatus`): `in_chair`, `done` or `left`; a repeat is a no-op. */
suspend fun ClinicApi.setTokenStatus(
    id: String,
    status: String,
): Outcome<QueueToken, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/queue/${id.encodeURLPathPart()}/status")
        contentType(ContentType.Application.Json)
        setBody(TokenStatusChange(status = status))
    }

/**
 * `POST /api/v1/queue/{id}/start-visit` (`startVisitFromQueue`): seats the token and starts (or
 * reuses) its visit; tapping twice returns the same visit.
 */
suspend fun ClinicApi.startVisitFromQueue(id: String): Outcome<StartedVisit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/queue/${id.encodeURLPathPart()}/start-visit")
    }

/** `GET /api/v1/quick-picks` (`getQuickPicks`): the clinic's specialty quick picks. */
suspend fun ClinicApi.quickPicks(): Outcome<QuickPicks, ApiError> = client.call { url("api/v1/quick-picks") }
