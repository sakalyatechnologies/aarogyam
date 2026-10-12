package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.addFamily
import com.aarogyam.staff.api.family
import com.aarogyam.staff.api.removeFamily
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.FamilyLink
import com.aarogyam.staff.config.caps.NewFamilyLink
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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

/** A patient found by number or name, who could be linked as a relative. */
data class LinkCandidate(
    val patientId: String,
    val number: String,
    val name: String,
)

/** What the "Link existing patient" search shows. */
sealed interface LinkSearch {
    data object Idle : LinkSearch

    data object Searching : LinkSearch

    /** [items] leave out the patient themselves and anyone already linked. */
    data class Found(
        val query: String,
        val items: List<LinkCandidate>,
    ) : LinkSearch

    data class Failed(
        val error: ScreenError,
    ) : LinkSearch
}

/** Why a link cannot be made yet; the screen shows nothing until all are cleared. */
enum class LinkProblem { NoPatient, Themselves, AlreadyLinked, BadRelation }

/** The relations the server accepts on `POST /patients/{id}/family`. */
val FAMILY_RELATIONS: List<String> = listOf("guardian", "child", "spouse", "parent", "sibling", "other")

/** Checks a link before it is sent (the server also refuses: 409 for themselves or a pair already linked). */
fun linkProblems(
    patientId: String,
    pickedId: String?,
    relation: String?,
    linkedIds: Set<String>,
): List<LinkProblem> =
    buildList {
        when {
            pickedId == null -> add(LinkProblem.NoPatient)
            pickedId == patientId -> add(LinkProblem.Themselves)
            pickedId in linkedIds -> add(LinkProblem.AlreadyLinked)
        }
        if (relation == null || relation !in FAMILY_RELATIONS) add(LinkProblem.BadRelation)
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
    private val mutableSearch = MutableStateFlow<LinkSearch>(LinkSearch.Idle)
    private var searchJob: Job? = null

    /** The "Link existing patient" search results. */
    val search: StateFlow<LinkSearch> = mutableSearch.asStateFlow()

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

    /** Searches patients by number (or name) for [query]; needs `patients.write` since it leads to a link. */
    fun searchCandidates(query: String) {
        val text = query.trim()
        searchJob?.cancel()
        if (PATIENTS_WRITE !in clinic.permissions || text.length < MIN_QUERY) {
            mutableSearch.value = LinkSearch.Idle
            return
        }
        mutableSearch.value = LinkSearch.Searching
        searchJob =
            scope.launch {
                when (val result = clinic.api.searchPatients(text)) {
                    is Outcome.Success -> {
                        val linked =
                            (mutableState.value as? FamilyState.Loaded)
                                ?.items
                                .orEmpty()
                                .map { it.patientId }
                                .toSet()
                        mutableSearch.value =
                            LinkSearch.Found(
                                text,
                                result.value.items
                                    .filter { it.id != patientId && it.id !in linked }
                                    .map { LinkCandidate(it.id, it.number, it.fullName) },
                            )
                    }

                    is Outcome.Failure -> {
                        log.warn("family.search_failed") { code("error", result.error.code.value) }
                        mutableSearch.value = LinkSearch.Failed(ScreenError.of(result.error))
                    }
                }
            }
    }

    fun clearSearch() {
        searchJob?.cancel()
        mutableSearch.value = LinkSearch.Idle
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
        const val MIN_QUERY = 2
    }
}
