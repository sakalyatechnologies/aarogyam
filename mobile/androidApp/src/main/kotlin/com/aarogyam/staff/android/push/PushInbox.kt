package com.aarogyam.staff.android.push

import android.content.Context
import android.content.Intent
import com.aarogyam.staff.notifications.PushTap
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Where the platform's push events wait for the app: the FCM token and the last tapped alert.
 * Memory only; ids and a path, never a name, and the token is never logged.
 */
object PushInbox {
    /** The four data keys the server sends. */
    val KEYS = listOf("kind", "org_id", "id", "href")

    private val heldToken = MutableStateFlow<String?>(null)
    private val heldTap = MutableStateFlow<PushTap?>(null)
    private val wantsToday = MutableStateFlow(false)

    val token: StateFlow<String?> = heldToken.asStateFlow()
    val tap: StateFlow<PushTap?> = heldTap.asStateFlow()

    /** Set for a Today or Tasks alert; MainScreen takes it and selects the Today tab. */
    val showToday: StateFlow<Boolean> = wantsToday.asStateFlow()

    fun setToken(value: String) {
        heldToken.value = value
    }

    fun setTap(value: PushTap?) {
        heldTap.value = value
    }

    fun requestToday(on: Boolean) {
        wantsToday.value = on
    }

    /** A launch from a tapped alert (ours, or the system's for a background message) carries the four fields as extras. */
    fun handle(intent: Intent?) {
        val extras = intent?.extras ?: return
        val values = extras.keySet().associateWith { runCatching { extras.getString(it) }.getOrNull() }
        val tap = PushTap.ofOrNull(values) ?: return
        // Removed so a recreated activity does not replay the tap.
        KEYS.forEach { intent.removeExtra(it) }
        heldTap.value = tap
    }

    /** Asks FCM for the current token. Does nothing when the build carries no Firebase config. */
    @Suppress("DEPRECATION")
    fun fetchToken(context: Context) {
        if (!firebaseReady(context)) return
        runCatching {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener { if (!it.isNullOrBlank()) setToken(it) }
        }
    }

    fun firebaseReady(context: Context): Boolean =
        runCatching {
            FirebaseApp.getApps(context).isNotEmpty()
        }.getOrDefault(false)
}
