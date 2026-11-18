package com.aarogyam.staff.api

import io.ktor.client.plugins.api.Send
import io.ktor.client.plugins.api.createClientPlugin
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.util.AttributeKey

/** Configures [SessionEndWatch]. */
class SessionEndWatchConfig {
    /** Called when the server refuses a request even after the token was refreshed. */
    var onEnded: () -> Unit = {}
}

/** How many times one request was answered `401`; shared by the copies the retry plugin makes. */
private class Refusals {
    var count = 0
}

private val RefusalsKey = AttributeKey<Refusals>("aarogyam.refusals")

/**
 * Signs the person out when the API ends the session itself (idle or age limits, revoked): the
 * token refresh then succeeds at the identity provider, but the retried request is refused again.
 *
 * Installed after the kit's bearer refresh, so it sees each attempt. The first `401` is the one
 * the refresh answers; a second on the same request means the session is over. Requests sent
 * without a token are ignored. Generic: moves to sakalya-mobile with the next kit release.
 */
val SessionEndWatch =
    createClientPlugin("AarogyamSessionEndWatch", ::SessionEndWatchConfig) {
        val onEnded = pluginConfig.onEnded
        onRequest { request, _ -> request.attributes.put(RefusalsKey, Refusals()) }
        on(Send) { request ->
            val call = proceed(request)
            val refused = call.response.status == HttpStatusCode.Unauthorized
            val refusals = request.attributes.getOrNull(RefusalsKey)
            if (refused && refusals != null && request.headers.contains(HttpHeaders.Authorization)) {
                refusals.count += 1
                if (refusals.count >= 2) onEnded()
            }
            call
        }
    }
