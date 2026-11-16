package com.aarogyam.staff.api

import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The body of `PUT /api/v1/me/devices/{installation_id}`; [token] is the APNs hex and is never logged. */
@Serializable
data class DeviceRegistration(
    val platform: String,
    val token: String,
    val app: String,
    val locale: String,
    @SerialName("app_version") val appVersion: String,
) {
    // The default `toString` would print the token into a log or a failed assertion.
    override fun toString(): String = "DeviceRegistration(platform=$platform, app=$app, locale=$locale)"
}

/** `PUT /api/v1/me/devices/{installation_id}`: registers or refreshes this phone's push token (204, an upsert). */
suspend fun AppApi.registerDevice(
    installationId: String,
    registration: DeviceRegistration,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/me/devices/${installationId.encodeURLPathPart()}")
        contentType(ContentType.Application.Json)
        setBody(registration)
    }

/** `DELETE /api/v1/me/devices/{installation_id}`: stops pushes to this phone (204, idempotent). */
suspend fun AppApi.forgetDevice(installationId: String): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Delete
        url("api/v1/me/devices/${installationId.encodeURLPathPart()}")
    }

/** `POST /api/v1/notifications/{id}/read` (`markNotificationRead`): read for the caller only; repeating it changes nothing (204). */
suspend fun ClinicApi.markNotificationRead(id: String): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/notifications/${id.encodeURLPathPart()}/read")
    }

/**
 * `POST /api/v1/me/sessions/revoke-current`: ends this session on the server and drops its push
 * tokens, before the Supabase sign-out. 204; a repeat is 401.
 */
suspend fun AppApi.revokeCurrent(): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/me/sessions/revoke-current")
    }
