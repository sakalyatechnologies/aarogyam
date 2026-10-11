package com.aarogyam.staff.desk

import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.callToken
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.patients.sexOf
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One ticket on the waiting-room board. Details are for the screen only, never for logs. */
data class BoardTicket(
    val id: String,
    val tokenNumber: Int,
    val patientId: String,
    val name: String,
    val number: String,
    val ageYears: Int?,
    val sex: Sex,
    val state: PatientState,
    val doctor: String?,
    val waitMinutes: Long,
)

/** What the board draws. */
sealed interface DeskBoardState {
    data object Loading : DeskBoardState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : DeskBoardState

    data class Failed(
        val error: ScreenError,
    ) : DeskBoardState

    /**
     * [error] is a failed refresh or a failed Send in; the tickets shown are from the last good
     * load. [mine] is the doctor's "My patients" filter; [canFilterMine] says the toggle exists.
     */
    data class Loaded(
        val tickets: List<BoardTicket>,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
        val mine: Boolean = false,
        val canFilterMine: Boolean = false,
        val calling: Set<String> = emptySet(),
    ) : DeskBoardState
}

/**
 * Today's queue as a waiting-room board: one `GET /queue`, each token mapped through
 * [patientState]. A doctor's or owner's in-chair patient with an open visit is In consult; the
 * visit list needs `clinical.read`, so other roles see In chair. A doctor can send a waiting
 * patient in (`POST /queue/{id}/call`) and filter to their own patients (`practitioner_id`).
 */
class DeskBoardStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.deskboard"),
) {
    private val mutableState =
        MutableStateFlow<DeskBoardState>(
            if (APPOINTMENTS_READ in clinic.permissions) DeskBoardState.Loading else DeskBoardState.NotAllowed,
        )

    val state: StateFlow<DeskBoardState> = mutableState.asStateFlow()

    private var mine = false
    private var myPractitionerId: String? = null
    private val canFilterMine = CLINICAL_WRITE in clinic.permissions

    init {
        if (APPOINTMENTS_READ in clinic.permissions) load()
    }

    /** Reloads (pull to refresh, the 20 second poll, or after a failure). */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            DeskBoardState.NotAllowed -> {
                return
            }

            is DeskBoardState.Loaded -> {
                if (current.refreshing) {
                    return
                } else {
                    mutableState.value =
                        current.copy(refreshing = true)
                }
            }

            else -> {
                mutableState.value = DeskBoardState.Loading
            }
        }
        load()
    }

    /** Reloads on every change [live] reports, until the scope ends (the screen is gone). */
    fun observe(live: LiveUpdates) {
        scope.launch { live.changes().collect { refresh() } }
    }

    /** Doctors only: shows just my patients (the `practitioner_id` filter) or everyone. */
    fun setMine(on: Boolean) {
        if (!canFilterMine || on == mine) return
        mine = on
        (mutableState.value as? DeskBoardState.Loaded)?.let { mutableState.value = it.copy(mine = on, refreshing = true) }
        load()
    }

    /** The doctor sends a waiting patient in; the board shows what the server now has. */
    fun sendIn(tokenId: String) {
        val shown = mutableState.value as? DeskBoardState.Loaded ?: return
        if (CLINICAL_WRITE !in clinic.permissions || tokenId in shown.calling) return
        mutableState.value = shown.copy(calling = shown.calling + tokenId, error = null)
        scope.launch {
            val result = clinic.api.callToken(tokenId)
            if (result is Outcome.Failure) {
                log.warn("deskboard.call_failed") { code("error", result.error.code.value) }
                val error = ScreenError.of(result.error)
                (mutableState.value as? DeskBoardState.Loaded)?.let {
                    mutableState.value = it.copy(error = error, calling = it.calling - tokenId)
                }
            }
            load()
        }
    }

    private suspend fun myPractitioner(): String? {
        myPractitionerId?.let { return it }
        val me = clinic.session.membership.id
        return (clinic.reference.practitioners() as? Outcome.Success)
            ?.value
            ?.firstOrNull { it.membershipId == me }
            ?.id
            ?.also { myPractitionerId = it }
    }

    private fun load() {
        scope.launch {
            val filter = if (mine) myPractitioner() else null
            when (val result = clinic.api.queue(filter)) {
                is Outcome.Success -> {
                    val canSeeVisits = CLINICAL_READ in clinic.permissions
                    val tickets =
                        result.value.items.mapNotNull { token ->
                            val open = canSeeVisits && token.status == "in_chair" && hasOpenVisit(token.patient.id)
                            val state = patientState(token.status, token.calledAt, open) ?: return@mapNotNull null
                            BoardTicket(
                                id = token.id,
                                tokenNumber = token.tokenNumber,
                                patientId = token.patient.id,
                                name = token.patient.fullName,
                                number = token.patient.number,
                                ageYears = token.patient.ageYears,
                                sex = sexOf(token.patient.sex),
                                state = state,
                                doctor = token.practitioner?.displayName,
                                waitMinutes = token.waitMinutes,
                            )
                        }
                    mutableState.value = DeskBoardState.Loaded(tickets, mine = mine && filter != null, canFilterMine = canFilterMine)
                }

                is Outcome.Failure -> {
                    log.warn("deskboard.load_failed") { code("error", result.error.code.value) }
                    val error = ScreenError.of(result.error)
                    val current = mutableState.value as? DeskBoardState.Loaded
                    mutableState.value =
                        current?.copy(refreshing = false, error = error, calling = emptySet()) ?: DeskBoardState.Failed(error)
                }
            }
        }
    }

    private suspend fun hasOpenVisit(patientId: String): Boolean =
        (clinic.api.visits(patientId) as? Outcome.Success)?.value?.items?.any { it.endedAt == null } == true

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
        const val CLINICAL_READ = "clinical.read"
        const val CLINICAL_WRITE = "clinical.write"
    }
}
