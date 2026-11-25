package com.aarogyam.patient.devices

import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A place the patient is signed in. The API sends no device name, so [signedInAt] stands in for it. */
data class DeviceView(
    val id: String,
    val current: Boolean,
    val signedInAt: ClinicTime?,
    val lastActive: ClinicTime?,
)

/**
 * Signed-in devices. [confirming] is the device the person asked to sign out (the screen asks first);
 * [signingOut] the one being signed out; [signOutFailed] the last attempt did not go through.
 */
data class DevicesState(
    val loading: Boolean = true,
    val devices: List<DeviceView> = emptyList(),
    val error: ScreenError? = null,
    val confirming: String? = null,
    val signingOut: String? = null,
    val signOutFailed: Boolean = false,
)

/** `GET /me/patient/sessions` and `DELETE /me/patient/sessions/{id}`. The current device can't be signed out here. */
class DevicesStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient.devices"),
) {
    private val mutableState = MutableStateFlow(DevicesState())

    /** The current screen state. */
    val state: StateFlow<DevicesState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    /** Reloads the list. */
    fun refresh() {
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value

                    is Outcome.Failure -> return@launch mutableState.update {
                        it.copy(loading = false, error = ScreenError.of(found.error))
                    }
                }
            when (val list = api.sessions()) {
                is Outcome.Success -> {
                    val devices =
                        list.value.items.map {
                            DeviceView(
                                it.id,
                                it.current,
                                ClinicTime.parse(it.createdAt),
                                ClinicTime.parse(it.lastActiveAt),
                            )
                        }
                    mutableState.update { it.copy(loading = false, devices = devices) }
                }

                is Outcome.Failure -> {
                    log.warn("devices.list_failed") { code("error", list.error.code.value) }
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(list.error)) }
                }
            }
        }
    }

    /** The person tapped "Sign out" on a device: the screen shows its confirm. The current device is ignored. */
    fun askSignOut(id: String) {
        if (mutableState.value.devices.none { it.id == id && !it.current }) return
        mutableState.update { it.copy(confirming = id, signOutFailed = false) }
    }

    /** The person backed out of the confirm. */
    fun cancelConfirm() = mutableState.update { it.copy(confirming = null) }

    /** The person confirmed: signs that device out, then reloads. */
    fun confirmSignOut() {
        val id = mutableState.value.confirming ?: return
        if (mutableState.value.signingOut != null) return
        mutableState.update { it.copy(confirming = null, signingOut = id, signOutFailed = false) }
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value

                    is Outcome.Failure -> return@launch mutableState.update {
                        it.copy(signingOut = null, signOutFailed = true)
                    }
                }
            when (val result = api.revokeSession(id)) {
                is Outcome.Success -> {
                    log.info("device.signed_out") { id("session", id) }
                    mutableState.update { it.copy(signingOut = null) }
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("devices.sign_out_failed") { code("error", result.error.code.value) }
                    mutableState.update { it.copy(signingOut = null, signOutFailed = true) }
                }
            }
        }
    }
}
