package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Avatar
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod

/** `PUT /api/v1/me/avatar` (`putMyAvatar`) with the form field `preset`: an illustration the apps draw. A repeat replaces it. */
suspend fun ClinicApi.putMyAvatarPreset(preset: String): Outcome<Avatar, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/me/avatar")
        setBody(MultiPartFormDataContent(formData { append("preset", preset) }))
    }

/** `PUT /api/v1/me/avatar` with the form field `file`: a JPEG photo of at most 2 MB. */
suspend fun ClinicApi.putMyAvatarPhoto(jpeg: ByteArray): Outcome<Avatar, ApiError> =
    client.call {
        method = HttpMethod.Put
        url("api/v1/me/avatar")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append(
                        "file",
                        jpeg,
                        Headers.build {
                            append(HttpHeaders.ContentType, "image/jpeg")
                            append(HttpHeaders.ContentDisposition, "filename=\"avatar.jpg\"")
                        },
                    )
                },
            ),
        )
    }

/**
 * `GET /api/v1/avatars/{id}/content` by the signed [photoUrl] from an [Avatar] (a path on the
 * clinic's own host; the link is the proof of access and lasts an hour).
 */
suspend fun ClinicApi.avatarContent(photoUrl: String): Outcome<ByteArray, ApiError> =
    client.call { url(photoUrl.trimStart('/')) }
