package com.aarogyam.staff.notifications

import com.aarogyam.staff.api.AppApi
import com.aarogyam.staff.api.DeviceRegistration
import com.aarogyam.staff.api.forgetDevice
import com.aarogyam.staff.api.registerDevice
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.device.Preferences
import com.sakalya.mobile.core.DeviceId
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Keeps the server's record of this phone's push token current.
 *
 * The platform hands over the token ([setToken]) and the app's language ([setLocale]); while the
 * person is signed in, each change is sent with `PUT /me/devices/{installation id}`. A send that
 * fails is not repeated until the next app start (the accepted fingerprint is only saved on
 * success). [forget] sends the `DELETE` before sign-out finishes. The token is never logged or
 * stored: the preferences keep only the installation ID and a fingerprint.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PushRegistration(
    private val preferences: Preferences,
    signedIn: Flow<Boolean>,
    private val api: () -> AppApi?,
    scope: CoroutineScope,
    private val appVersion: String,
    private val log: Logger = Logger("aarogyam.push"),
) {
    private data class Wanted(
        val token: String,
        val locale: String,
    )

    private var token: String? = null
    private var locale: String = DEFAULT_LOCALE
    private val wanted = MutableStateFlow<Wanted?>(null)

    /** This installation's random ID, made once and kept in preferences. */
    val installationId: String
        get() =
            preferences.get(PreferenceKey.PushInstallationId)
                ?: DeviceId.generate().toString().also { preferences.set(PreferenceKey.PushInstallationId, it) }

    init {
        scope.launch {
            combine(signedIn, wanted) { on, want -> want.takeIf { on } }
                .collectLatest { want -> if (want != null) send(want) }
        }
    }

    /** The APNs token as hex, from the platform. */
    fun setToken(hex: String) {
        val clean = hex.trim().lowercase()
        if (clean.isEmpty()) return
        token = clean
        publish()
    }

    /** The app's language (`en`, `hi` or `mr`); anything else counts as `en`. */
    fun setLocale(tag: String) {
        locale = tag.substringBefore('-').lowercase().takeIf { it in LOCALES } ?: DEFAULT_LOCALE
        publish()
    }

    /** Best effort: tells the server to stop pushing to this phone, then forgets what it accepted. Never throws. */
    suspend fun forget() {
        val app = api()
        if (app != null) {
            val answer = withTimeoutOrNull(FORGET_TIMEOUT_MS) { app.forgetDevice(installationId) }
            when (answer) {
                is Outcome.Success -> log.info("push.forgotten")
                is Outcome.Failure -> log.warn("push.forget_failed") { code("error", answer.error.code.value) }
                null -> log.warn("push.forget_failed") { code("error", "timeout") }
            }
        }
        preferences.set(PreferenceKey.PushSent, null)
    }

    private fun publish() {
        val t = token ?: return
        wanted.value = Wanted(t, locale)
    }

    private suspend fun send(want: Wanted) {
        val fingerprint = "${want.locale}:${want.token.length}:${want.token.hashCode()}:$appVersion"
        if (preferences.get(PreferenceKey.PushSent) == fingerprint) return
        val app = api() ?: return
        val body = DeviceRegistration("ios", want.token, "staff", want.locale, appVersion)
        when (val answer = app.registerDevice(installationId, body)) {
            is Outcome.Success -> {
                preferences.set(PreferenceKey.PushSent, fingerprint)
                log.info("push.registered")
            }

            is Outcome.Failure -> {
                log.warn("push.register_failed") { code("error", answer.error.code.value) }
            }
        }
    }

    private companion object {
        const val DEFAULT_LOCALE = "en"
        val LOCALES = setOf("en", "hi", "mr")
        const val FORGET_TIMEOUT_MS = 4_000L
    }
}
