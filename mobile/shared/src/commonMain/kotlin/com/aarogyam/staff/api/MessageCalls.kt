package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.MessagesQueued
import com.aarogyam.staff.api.model.SendMessages
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType

/**
 * `POST /api/v1/messages` (`sendMessages`, needs `messages.send`): queues a message per patient who can be reached.
 * `no_address` and `no_consent` count the patients who got nothing. A retry with the same `batch_id` is not
 * queued twice.
 */
suspend fun ClinicApi.sendMessages(request: SendMessages): Outcome<MessagesQueued, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/messages")
        contentType(ContentType.Application.Json)
        setBody(request)
    }
