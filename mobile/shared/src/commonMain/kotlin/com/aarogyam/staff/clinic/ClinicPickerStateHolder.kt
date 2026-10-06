package com.aarogyam.staff.clinic

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.MyClinic
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A clinic row in the picker. */
data class ClinicChoice(
    val slug: String,
    val name: String,
    val roleName: String,
)

/** What the clinic picker draws. */
sealed interface ClinicPickerState {
    data object Loading : ClinicPickerState

    /** The person belongs to no clinic yet. */
    data object Empty : ClinicPickerState

    data class Failed(
        val error: ScreenError,
    ) : ClinicPickerState

    /** [opening] is the clinic being opened; [error] is why the last open failed. */
    data class Choose(
        val clinics: List<ClinicChoice>,
        val opening: String? = null,
        val error: ScreenError? = null,
    ) : ClinicPickerState
}

/**
 * Lists the person's clinics (one `/me`, cached) and opens one (one `/session`, cached). A person
 * with exactly one clinic goes straight in when [autoOpenSingle] (not after they chose to leave
 * it). Opening sets [ClinicDirectory.current], which the app's root observes.
 */
class ClinicPickerStateHolder(
    private val directory: ClinicDirectory,
    private val scope: CoroutineScope,
    private val autoOpenSingle: Boolean = true,
) {
    private val mutableState = MutableStateFlow<ClinicPickerState>(ClinicPickerState.Loading)
    private var clinics: List<MyClinic> = emptyList()

    /** The current screen state. */
    val state: StateFlow<ClinicPickerState> = mutableState.asStateFlow()

    init {
        load(refresh = false)
    }

    /** Loads again after a failure (refetching `/me`). */
    fun retry() = load(refresh = true)

    /** Opens the clinic with [slug]. */
    fun select(slug: String) {
        val current = mutableState.value as? ClinicPickerState.Choose ?: return
        if (current.opening != null) return
        val clinic = clinics.firstOrNull { it.slug == slug } ?: return
        mutableState.value = current.copy(opening = slug, error = null)
        scope.launch {
            val opened = directory.open(clinic)
            mutableState.update { state ->
                if (state !is ClinicPickerState.Choose) return@update state
                when (opened) {
                    is Outcome.Success -> state.copy(opening = null)
                    is Outcome.Failure -> state.copy(opening = null, error = ScreenError.of(opened.error))
                }
            }
        }
    }

    private fun load(refresh: Boolean) {
        mutableState.value = ClinicPickerState.Loading
        scope.launch {
            when (val loaded = directory.clinics(refresh)) {
                is Outcome.Failure -> {
                    mutableState.value = ClinicPickerState.Failed(ScreenError.of(loaded.error))
                }

                is Outcome.Success -> {
                    clinics = loaded.value
                    val choices = clinics.map { ClinicChoice(it.slug, it.name, it.roleName) }
                    mutableState.value =
                        if (choices.isEmpty()) ClinicPickerState.Empty else ClinicPickerState.Choose(choices)
                    if (autoOpenSingle) choices.singleOrNull()?.let { select(it.slug) }
                }
            }
        }
    }
}
