package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Consent
import com.aarogyam.staff.api.model.ConsentList
import com.aarogyam.staff.api.model.ConsentNoticeList
import com.aarogyam.staff.api.model.RecordConsent
import com.aarogyam.staff.api.model.SetConsentSignature
import com.aarogyam.staff.api.model.WithdrawConsent
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import com.sakalya.mobile.http.idempotencyKey
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/patients/{id}/consents` (`listPatientConsents`): newest first, given and withdrawn. */
suspend fun ClinicApi.consents(patientId: String): Outcome<ConsentList, ApiError> =
    client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/consents") }

/** `GET /api/v1/consent-notices` (`listConsentNotices`): the clinic's published notices. */
suspend fun ClinicApi.consentNotices(): Outcome<ConsentNoticeList, ApiError> =
    client.call { url("api/v1/consent-notices") }

/** `POST /api/v1/patients/{id}/consents` (`recordPatientConsent`); [key] travels as `Idempotency-Key`. */
suspend fun ClinicApi.recordConsent(
    patientId: String,
    body: RecordConsent,
    key: IdempotencyKey,
): Outcome<Consent, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/consents")
        idempotencyKey(key)
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/**
 * `PUT /api/v1/patients/{id}/consents/{consent_id}/signature` (`setPatientConsentSignature`): links an
 * uploaded `consent` file. Set once; the same file again is a 200, another is 409 `signature_already_set`.
 */
suspend fun ClinicApi.setConsentSignature(
    patientId: String,
    consentId: String,
    attachmentId: String,
): Outcome<Consent, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/patients/${patientId.encodeURLPathPart()}/consents/${consentId.encodeURLPathPart()}/signature")
        contentType(ContentType.Application.Json)
        setBody(SetConsentSignature(signatureAttachmentId = attachmentId))
    }

/** `POST /api/v1/consents/{id}/withdraw` (`withdrawPatientConsent`). */
suspend fun ClinicApi.withdrawConsent(
    consentId: String,
    body: WithdrawConsent,
): Outcome<Consent, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/consents/${consentId.encodeURLPathPart()}/withdraw")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
