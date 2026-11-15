package com.aarogyam.patient.visits

import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.api.PatientAppApi
import com.aarogyam.patient.api.model.MyVisits
import com.aarogyam.patient.records.ListStateHolder
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The visits list: loading, failed (offline and so on), or the visits; empty is `Loaded` with no items. */
class VisitsStateHolder(
    private val directory: PatientDirectory,
    scope: CoroutineScope,
) : ListStateHolder<MyVisits, VisitView>(directory, scope) {
    init {
        refresh()
    }

    override suspend fun fetch(api: PatientAppApi): Outcome<MyVisits, ApiError> = api.visits()

    /** Newest first across clinics (ISO dates sort as text; the sort is stable). */
    override fun rows(
        body: MyVisits,
        clinicName: (String) -> String,
    ): List<VisitView> =
        body.items
            .map { it.view(bookingUrl(directory, it.clinicId, it.bookingPath)) }
            .sortedByDescending { it.visitedOn }
}

/** One visit's screen: loading, failed ([ScreenError.NotFound] for a visit that is not the patient's), or loaded. */
sealed interface VisitState {
    data object Loading : VisitState

    data class Failed(
        val error: ScreenError,
    ) : VisitState

    data class Loaded(
        val visit: VisitView,
    ) : VisitState
}

/** Loads `GET /me/patient/visits/{id}` once and on [refresh]. */
class VisitStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val id: String,
) {
    private val mutableState = MutableStateFlow<VisitState>(VisitState.Loading)

    /** The current screen state. */
    val state: StateFlow<VisitState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    /** Reloads; a failure after a successful load keeps the visit on screen. */
    fun refresh() {
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value
                    is Outcome.Failure -> return@launch fail(ScreenError.of(found.error))
                }
            directory.load()
            when (val body = api.visit(id)) {
                is Outcome.Success -> {
                    mutableState.value =
                        VisitState.Loaded(
                            body.value.view(bookingUrl(directory, body.value.clinicId, body.value.bookingPath)),
                        )
                }

                is Outcome.Failure -> {
                    fail(ScreenError.of(body.error))
                }
            }
        }
    }

    private fun fail(error: ScreenError) {
        if (mutableState.value !is VisitState.Loaded) mutableState.value = VisitState.Failed(error)
    }
}

private fun bookingUrl(
    directory: PatientDirectory,
    clinicId: String?,
    path: String,
): String? = clinicId?.let { directory.clinicUrl(it, path) }
