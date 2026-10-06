package com.aarogyam.staff.patients

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Patient
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One row of the patient list. Details are for the screen only, never for logs. */
data class PatientRow(
    val id: String,
    val name: String,
    val number: String,
    val ageYears: Int?,
    val sex: Sex,
    val phone: String?,
    val recallDue: Boolean,
)

/** A patient's recorded sex; values the app doesn't know yet are [Unknown]. */
enum class Sex { Female, Male, Other, Unknown }

/** What the Patients screen draws. [query] is what the person typed, kept so the field survives a tab switch. */
sealed interface PatientsState {
    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : PatientsState

    data class Loading(
        val query: String,
    ) : PatientsState

    data class Failed(
        val query: String,
        val error: ScreenError,
    ) : PatientsState

    /** [items] answer [query]; [searching] while a newer query runs (the old rows stay until it answers). */
    data class Loaded(
        val query: String,
        val items: List<PatientRow>,
        val searching: Boolean = false,
    ) : PatientsState
}

/**
 * Search-as-you-type over the clinic's patients. Typing waits [debounceMillis] for a pause, then
 * sends exactly one `POST /patients/search`; a newer query cancels an older one still waiting or
 * in flight. An empty query lists the newest patients straight away.
 */
class PatientsStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patients"),
    private val debounceMillis: Long = DEBOUNCE_MILLIS,
) {
    private val mutableState = MutableStateFlow<PatientsState>(PatientsState.Loading(""))

    /** The current screen state. */
    val state: StateFlow<PatientsState> = mutableState.asStateFlow()

    private var job: Job? = null
    private var requested: String? = null

    init {
        if (PATIENTS_READ in
            clinic.permissions
        ) {
            run("", wait = false)
        } else {
            mutableState.value = PatientsState.NotAllowed
        }
    }

    /** The person typed [text]; searches once they pause. The same query twice sends nothing new. */
    fun search(text: String) {
        if (mutableState.value == PatientsState.NotAllowed) return
        val query = text.trim()
        val shown = mutableState.value
        if (shown !is PatientsState.Failed && query == requested) {
            mutableState.value = shown.withQuery(text)
            return
        }
        mutableState.value = shown.withQuery(text).searching()
        run(query, wait = query.isNotEmpty(), typed = text)
    }

    /** Runs the current query again, after a failure or on pull-to-refresh. */
    fun retry() {
        val shown = mutableState.value
        if (shown == PatientsState.NotAllowed) return
        mutableState.value = shown.searching()
        run(requested ?: "", wait = false, typed = shown.queryText())
    }

    private fun run(
        query: String,
        wait: Boolean,
        typed: String = query,
    ) {
        job?.cancel()
        requested = query
        job =
            scope.launch {
                if (wait) delay(debounceMillis)
                when (val result = clinic.api.searchPatients(query)) {
                    is Outcome.Success -> {
                        mutableState.value = PatientsState.Loaded(typed, result.value.items.map { it.toRow() })
                    }

                    is Outcome.Failure -> {
                        log.warn("patients.search_failed") { code("error", result.error.code.value) }
                        requested = null
                        mutableState.value = PatientsState.Failed(typed, ScreenError.of(result.error))
                    }
                }
            }
    }

    private fun PatientsState.queryText(): String =
        when (this) {
            PatientsState.NotAllowed -> ""
            is PatientsState.Loading -> query
            is PatientsState.Failed -> query
            is PatientsState.Loaded -> query
        }

    private fun PatientsState.withQuery(text: String): PatientsState =
        when (this) {
            PatientsState.NotAllowed -> this
            is PatientsState.Loading -> copy(query = text)
            is PatientsState.Failed -> copy(query = text)
            is PatientsState.Loaded -> copy(query = text)
        }

    private fun PatientsState.searching(): PatientsState =
        when (this) {
            is PatientsState.Loaded -> copy(searching = true)
            is PatientsState.Failed -> PatientsState.Loading(query)
            else -> this
        }

    private companion object {
        const val PATIENTS_READ = "patients.read"
        const val DEBOUNCE_MILLIS = 300L
    }
}

private fun Patient.toRow() =
    PatientRow(
        id = id,
        name = fullName,
        number = number,
        ageYears = ageYears,
        sex = sexOf(sex),
        phone = phone,
        recallDue = recallDue,
    )

internal fun sexOf(text: String): Sex =
    when (text) {
        "female" -> Sex.Female
        "male" -> Sex.Male
        "other" -> Sex.Other
        else -> Sex.Unknown
    }
