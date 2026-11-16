package com.aarogyam.staff.android.ui.auth

import android.content.Intent
import com.aarogyam.staff.signin.InviteLink
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * An invitation link opened as `aarogyam://invite#<token>` (or pasted), waiting for sign-in and Join.
 * It lives in memory only: never logged, never written to disk.
 */
object PendingInvite {
    private val held = MutableStateFlow<String?>(null)
    val link: StateFlow<String?> = held.asStateFlow()

    fun set(link: String?) {
        held.value = link
    }

    /** Takes the URL the system opened the app with; only `aarogyam://invite#<token>` links count. */
    fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "aarogyam" || uri.host != "invite") return
        val text = uri.toString()
        if (InviteLink.parse(text) != null) held.value = text
    }
}
