package com.aarogyam.staff.signin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.AppApi
import com.aarogyam.staff.api.deleteAccount
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Where "Delete account" stands. */
sealed interface DeleteAccountState {
    data object Idle : DeleteAccountState

    data object Deleting : DeleteAccountState

    /** Deleted on the server; this device is signed out. */
    data object Deleted : DeleteAccountState

    /** The person is the only owner of these clinics, so someone else must own them first. */
    data class LastOwner(
        val clinicNames: List<String>,
    ) : DeleteAccountState

    /** A Sakalya staff account: closed from the console, not here. */
    data object PlatformStaff : DeleteAccountState

    /** 404 `no_staff_account`: this sign-in has no clinic staff profile to delete. */
    data object NotStaff : DeleteAccountState

    data class Failed(
        val error: ScreenError,
    ) : DeleteAccountState
}

/**
 * `DELETE /api/v1/me/account`. The server revokes every session, so on success [signOutLocally]
 * clears this device without calling Supabase. Unsent outbox items go with it. Logs codes only.
 */
class DeleteAccountHolder(
    private val app: AppApi?,
    private val scope: CoroutineScope,
    private val signOutLocally: () -> Unit,
    private val log: Logger = Logger("aarogyam.delete_account"),
) {
    private val mutableState = MutableStateFlow<DeleteAccountState>(DeleteAccountState.Idle)
    val state: StateFlow<DeleteAccountState> = mutableState.asStateFlow()

    /** Asks the server to delete the account; the screen has already confirmed. */
    fun delete() {
        if (mutableState.value is DeleteAccountState.Deleting ||
            mutableState.value is DeleteAccountState.Deleted
        ) {
            return
        }
        val api = app ?: return mutableState.run { value = DeleteAccountState.Failed(ScreenError.NotConfigured) }
        mutableState.value = DeleteAccountState.Deleting
        scope.launch {
            when (val answer = api.deleteAccount()) {
                is Outcome.Success -> {
                    log.info("account.deleted")
                    mutableState.value = DeleteAccountState.Deleted
                    signOutLocally()
                }

                is Outcome.Failure -> {
                    val code = answer.error.error.code.value
                    log.warn("account.delete_failed") { code("error", code) }
                    mutableState.value =
                        when (code) {
                            "last_owner" -> {
                                DeleteAccountState.LastOwner(
                                    answer.error.body
                                        ?.clinics
                                        .orEmpty()
                                        .map { it.name },
                                )
                            }

                            "platform_staff" -> {
                                DeleteAccountState.PlatformStaff
                            }

                            "no_staff_account" -> {
                                DeleteAccountState.NotStaff
                            }

                            else -> {
                                DeleteAccountState.Failed(ScreenError.of(answer.error.error))
                            }
                        }
                }
            }
        }
    }

    /** Dismisses a refusal or an error so the sheet can be tried again or closed. */
    fun reset() {
        if (mutableState.value !is DeleteAccountState.Deleting) mutableState.value = DeleteAccountState.Idle
    }
}
