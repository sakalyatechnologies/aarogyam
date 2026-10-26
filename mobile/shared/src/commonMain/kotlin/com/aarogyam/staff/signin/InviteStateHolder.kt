package com.aarogyam.staff.signin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.acceptInvitation
import com.aarogyam.staff.api.model.AcceptInvitation
import com.aarogyam.staff.clinic.ClinicDirectory
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Joining a clinic from an invitation link. */
sealed interface InviteState {
    /** No link yet: the Join screen offers "Paste the link". */
    data object NeedsLink : InviteState

    /** The pasted text is not an invitation link. */
    data object BadLink : InviteState

    /** A link is held (in memory); the person signs in, then accepts. */
    data object Ready : InviteState

    data object Joining : InviteState

    /** Joined: the clinic list was refreshed and [orgId] is among it. */
    data class Joined(
        val orgId: String,
    ) : InviteState

    /** Refused, for example because the link expired or was sent to another email. */
    data class Failed(
        val error: ScreenError,
    ) : InviteState
}

/**
 * Accepts an invitation after sign-in: `POST /invitations/accept` on the app host, then refreshes
 * the clinic list. The token lives only in this object and goes only into that request body.
 */
class InviteStateHolder(
    private val directory: ClinicDirectory,
    private val scope: CoroutineScope,
    link: String? = null,
    private val log: Logger = Logger("aarogyam.invite"),
) {
    private var token: InviteToken? = link?.let(InviteLink::parse)
    private val mutableState = MutableStateFlow(if (token != null) InviteState.Ready else InviteState.NeedsLink)
    val state: StateFlow<InviteState> = mutableState.asStateFlow()

    /** Takes a link opened in the app or pasted by the person. */
    fun useLink(text: String) {
        val parsed = InviteLink.parse(text)
        token = parsed ?: token
        mutableState.value = if (parsed != null) InviteState.Ready else InviteState.BadLink
    }

    /** Joins with [displayName] (shown to colleagues; only used on a first sign-in). Needs a signed-in session. */
    fun accept(displayName: String?) {
        val secret = token ?: return
        if (mutableState.value == InviteState.Joining) return
        val app =
            directory.appApi() ?: return run { mutableState.value = InviteState.Failed(ScreenError.NotConfigured) }
        mutableState.value = InviteState.Joining
        scope.launch {
            val body = AcceptInvitation(token = secret.value, displayName = displayName?.trim()?.ifEmpty { null })
            mutableState.value =
                when (val answer = app.acceptInvitation(body)) {
                    is Outcome.Success -> {
                        token = null
                        log.info("invite.accepted") { id("org", answer.value.orgId) }
                        directory.clinics(refresh = true)
                        InviteState.Joined(answer.value.orgId)
                    }

                    is Outcome.Failure -> {
                        log.warn("invite.failed") { code("error", answer.error.code.value) }
                        InviteState.Failed(ScreenError.of(answer.error))
                    }
                }
        }
    }

    /** Forgets the link (the person backed out). */
    fun forget() {
        token = null
        mutableState.value = InviteState.NeedsLink
    }
}
