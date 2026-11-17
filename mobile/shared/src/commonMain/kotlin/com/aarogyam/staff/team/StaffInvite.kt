package com.aarogyam.staff.team

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.inviteStaff
import com.aarogyam.staff.api.model.NewInvitation
import com.aarogyam.staff.api.roles
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A role chip on the invite sheet. */
data class RoleChoice(
    val key: String,
    val name: String,
)

/** The invite sheet. The email is never logged, and the invite token in the answer is dropped. */
data class StaffInviteState(
    val allowed: Boolean,
    val roles: List<RoleChoice> = emptyList(),
    val loadingRoles: Boolean = false,
    val email: String = "",
    val roleKey: String? = null,
    val sending: Boolean = false,
    /** Set once sent: who the invitation went to. */
    val sentTo: String? = null,
    /** The email doesn't look like one; shown under the field once something is typed. */
    val emailInvalid: Boolean = false,
    val error: ScreenError? = null,
) {
    val canSend: Boolean get() = allowed && !sending && sentTo == null && roleKey != null && looksLikeEmail(email)
}

/**
 * Invites someone to the clinic with `POST /staff/invitations` (`staff.manage`): their email and
 * a role from `GET /roles`. The server creates their sign-in account and emails the link; they
 * accept by signing in with that email. Only an owner may invite an owner, so others don't see
 * the owner role.
 */
class InviteStaffStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.invite"),
) {
    private val mutableState = MutableStateFlow(StaffInviteState(allowed = STAFF_MANAGE in clinic.permissions))
    val state: StateFlow<StaffInviteState> = mutableState.asStateFlow()

    init {
        if (mutableState.value.allowed) loadRoles()
    }

    fun loadRoles() {
        mutableState.update { it.copy(loadingRoles = true, error = null) }
        scope.launch {
            when (val answer = clinic.api.roles()) {
                is Outcome.Success -> {
                    val owner = clinic.session.membership.roleKey == OWNER
                    val roles =
                        answer.value.items
                            .filter { owner || it.key != OWNER }
                            .map { RoleChoice(it.key, it.name) }
                    mutableState.update { s ->
                        s.copy(loadingRoles = false, roles = roles, roleKey = s.roleKey ?: roles.singleOrNull()?.key)
                    }
                }

                is Outcome.Failure -> {
                    log.warn("invite.roles_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(loadingRoles = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    fun setEmail(text: String) =
        mutableState.update {
            val email = text.trim().take(MAX_EMAIL)
            it.copy(email = email, emailInvalid = email.isNotEmpty() && !looksLikeEmail(email), error = null)
        }

    fun chooseRole(key: String) = mutableState.update { it.copy(roleKey = key, error = null) }

    fun send() {
        val s = mutableState.value
        val role = s.roleKey ?: return
        if (!s.canSend) return
        mutableState.update { it.copy(sending = true, error = null) }
        scope.launch {
            when (val answer = clinic.api.inviteStaff(NewInvitation(email = s.email, roleKey = role))) {
                is Outcome.Success -> {
                    log.info("invite.sent") { code("role", role) }
                    mutableState.update { it.copy(sending = false, sentTo = s.email) }
                }

                is Outcome.Failure -> {
                    // 503: the sign-in account could not be made; the person can try again.
                    log.warn("invite.failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(sending = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** Clears the sheet for the next person, keeping the role. */
    fun another() = mutableState.update { it.copy(email = "", sentTo = null, emailInvalid = false, error = null) }

    private companion object {
        const val STAFF_MANAGE = "staff.manage"
        const val OWNER = "owner"
        const val MAX_EMAIL = 254
    }
}

private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

internal fun looksLikeEmail(text: String): Boolean = EMAIL.matches(text)
