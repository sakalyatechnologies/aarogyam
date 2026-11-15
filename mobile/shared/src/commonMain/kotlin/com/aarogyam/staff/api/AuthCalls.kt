package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AcceptInvitation
import com.aarogyam.staff.api.model.Joined
import com.aarogyam.staff.api.model.NewRegistration
import com.aarogyam.staff.api.model.RegistrationReceived
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.BodyFailure
import com.sakalya.mobile.http.call
import com.sakalya.mobile.http.callWithErrorBody
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.Serializable

/** `POST /api/v1/registrations` (`register`): a new clinic asks to join; Sakalya approves it in the console. */
suspend fun AppApi.register(registration: NewRegistration): Outcome<RegistrationReceived, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/registrations")
        contentType(ContentType.Application.Json)
        setBody(registration)
    }

/**
 * `POST /api/v1/invitations/accept` (`acceptInvitation`): joins the clinic that sent the invitation.
 * The signed-in email must match the invited one. The token travels only in this body.
 */
suspend fun AppApi.acceptInvitation(accept: AcceptInvitation): Outcome<Joined, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/invitations/accept")
        contentType(ContentType.Application.Json)
        setBody(accept)
    }

/**
 * `DELETE /api/v1/me/account` (`deleteAccount`) with `{"confirm":"delete"}`: 204 deletes the account and
 * revokes every session. 409 `last_owner` lists the clinics the person alone owns (in [BodyFailure.body]);
 * 409 `platform_staff` has no list. The host is the app host: `/me` has no clinic.
 */
suspend fun AppApi.deleteAccount(): Outcome<Unit, BodyFailure<AccountBlocked>> =
    client.callWithErrorBody(HttpStatusCode.Conflict.value) {
        method = HttpMethod.Delete
        url("api/v1/me/account")
        contentType(ContentType.Application.Json)
        setBody(DeleteAccountRequest(confirm = "delete"))
    }

/** The body of [deleteAccount]. */
@Serializable
data class DeleteAccountRequest(
    // No default: the JSON encoder leaves defaults out, and the server wants `{"confirm":"delete"}`.
    val confirm: String,
)

/** A 409 from [deleteAccount]: the clinics that would be left without an owner (empty for `platform_staff`). */
@Serializable
data class AccountBlocked(
    val clinics: List<BlockedClinic> = emptyList(),
)

/** One clinic in [AccountBlocked]. */
@Serializable
data class BlockedClinic(
    val id: String = "",
    val name: String = "",
)
