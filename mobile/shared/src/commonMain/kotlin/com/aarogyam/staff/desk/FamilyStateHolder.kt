package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.addFamily
import com.aarogyam.staff.api.family
import com.aarogyam.staff.api.model.FamilyLink
import com.aarogyam.staff.api.model.NewFamilyLink
import com.aarogyam.staff.api.removeFamily
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One relative of a patient. [relation] is what they are to this patient. */
data class Relative(
    val linkId: String,
    val patientId: String,
    val number: String,
    val name: String,
    val relation: String,
    val primaryContact: Boolean,
)

/** What the family section draws. */
sealed interface FamilyState {
    data object Loading : FamilyState

    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : FamilyState

    data class Failed(
        val error: ScreenError,
    ) : FamilyState

    /** [canEdit] (`patients.write`) gates add and remove; [actionError] is the last refused change. */
    data class Loaded(
        val items: List<Relative>,
        val canEdit: Boolean,
        val actionError: ScreenError? = null,
    ) : FamilyState
}

/**
 * The family section of the desk flow for one patient: `GET`, `POST` and `DELETE`
 * `/patients/{id}/family`. The server writes and removes the inverse link too.
 */
class FamilyStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.family"),
) {
    private val mutableState =
        MutableStateFlow<FamilyState>(
            if (PATIENTS_READ in clinic.permissions) FamilyState.Loading else FamilyState.NotAllowed,
        )

    val state: StateFlow<FamilyState> = mutableState.asStateFlow()

    init {
        if (PATIENTS_READ in clinic.permissions) load()
    }

    fun refresh() {
        if (mutableState.value != FamilyState.NotAllowed) load()
    }

    /** Links [relatedPatientId], who is [relation] to this patient (`guardian`, `child`, `spouse`, `parent`, `sibling`, `other`). */
    fun add(
        relatedPatientId: String,
        relation: String,
        primaryContact: Boolean = false,
    ) = change("family.add_failed") {
        clinic.api.addFamily(patientId, NewFamilyLink(relatedPatientId, relation, primaryContact))
    }

    fun remove(linkId: String) = change("family.remove_failed") { clinic.api.removeFamily(patientId, linkId) }

    private fun <T> change(
        event: String,
        call: suspend () -> Outcome<T, com.sakalya.mobile.core.ApiError>,
    ) {
        if (PATIENTS_WRITE !in clinic.permissions) return
        scope.launch {
            val result = call()
            if (result is Outcome.Failure) {
                log.warn(event) { code("error", result.error.code.value) }
                mutableState.update {
                    if (it is FamilyState.Loaded) it.copy(actionError = ScreenError.of(result.error)) else it
                }
            }
            load()
        }
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.family(patientId)) {
                is Outcome.Success -> {
                    val shownError = (mutableState.value as? FamilyState.Loaded)?.actionError
                    mutableState.value =
                        FamilyState.Loaded(
                            result.value.items.map { it.toRelative() },
                            PATIENTS_WRITE in clinic.permissions,
                            shownError,
                        )
                }

                is Outcome.Failure -> {
                    log.warn("family.load_failed") { code("error", result.error.code.value) }
                    mutableState.value = FamilyState.Failed(ScreenError.of(result.error))
                }
            }
        }
    }

    private fun FamilyLink.toRelative() = Relative(id, patientId, number, fullName, relation, isPrimaryContact)

    private companion object {
        const val PATIENTS_READ = "patients.read"
        const val PATIENTS_WRITE = "patients.write"
    }
}
