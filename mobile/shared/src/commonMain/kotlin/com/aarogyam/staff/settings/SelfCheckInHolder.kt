package com.aarogyam.staff.settings

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.newSelfCheckInKey
import com.aarogyam.staff.api.selfCheckIn
import com.aarogyam.staff.api.setSelfCheckIn
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the self check-in settings screen draws. */
sealed interface SelfCheckInState {
    /** The role lacks settings.manage: the screen is not offered. */
    data object NotAllowed : SelfCheckInState

    data object Loading : SelfCheckInState

    data class Failed(
        val error: ScreenError,
    ) : SelfCheckInState

    data class Loaded(
        val enabled: Boolean,
        /** The address the QR opens; null until a QR is made. Anyone with it can send check-ins. */
        val url: String?,
        val saving: Boolean = false,
        val error: ScreenError? = null,
    ) : SelfCheckInState
}

/** The clinic's QR self check-in: the switch, the QR link, and a new key. */
class SelfCheckInHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.selfcheckin"),
) {
    private val mutable =
        MutableStateFlow<SelfCheckInState>(
            if (SETTINGS_MANAGE in clinic.permissions) SelfCheckInState.Loading else SelfCheckInState.NotAllowed,
        )
    val state: StateFlow<SelfCheckInState> = mutable.asStateFlow()

    init {
        if (mutable.value == SelfCheckInState.Loading) load()
    }

    fun load() {
        if (mutable.value == SelfCheckInState.NotAllowed) return
        scope.launch {
            when (val result = clinic.api.selfCheckIn()) {
                is Outcome.Success -> {
                    mutable.value = SelfCheckInState.Loaded(result.value.enabled, result.value.url)
                }

                is Outcome.Failure -> {
                    log.warn("selfcheckin.load_failed") { code("error", result.error.code.value) }
                    mutable.value = SelfCheckInState.Failed(ScreenError.of(result.error))
                }
            }
        }
    }

    /** Switches the QR on or off; switching on makes the first link. */
    fun setEnabled(on: Boolean) = save { clinic.api.setSelfCheckIn(on) }

    /** A new link: the old QR stops working. The screen confirms first. */
    fun regenerateKey() = save { clinic.api.newSelfCheckInKey() }

    private fun save(
        call: suspend () -> Outcome<com.aarogyam.staff.api.model.SelfCheckInSettings, com.sakalya.mobile.core.ApiError>,
    ) {
        val shown = mutable.value as? SelfCheckInState.Loaded ?: return
        if (shown.saving) return
        mutable.value = shown.copy(saving = true, error = null)
        scope.launch {
            when (val result = call()) {
                is Outcome.Success -> {
                    mutable.value = SelfCheckInState.Loaded(result.value.enabled, result.value.url)
                }

                is Outcome.Failure -> {
                    log.warn("selfcheckin.save_failed") { code("error", result.error.code.value) }
                    mutable.update {
                        (it as? SelfCheckInState.Loaded)?.copy(saving = false, error = ScreenError.of(result.error))
                            ?: it
                    }
                }
            }
        }
    }

    private companion object {
        const val SETTINGS_MANAGE = "settings.manage"
    }
}
