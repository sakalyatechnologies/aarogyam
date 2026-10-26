package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AcceptInvitation
import com.aarogyam.staff.api.model.Joined
import com.aarogyam.staff.api.model.NewRegistration
import com.aarogyam.staff.api.model.RegistrationReceived
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType

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
