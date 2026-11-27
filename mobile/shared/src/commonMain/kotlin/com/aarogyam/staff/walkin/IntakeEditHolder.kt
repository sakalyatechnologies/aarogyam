package com.aarogyam.staff.walkin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.intakeOptions
import com.aarogyam.staff.api.model.IntakeOptions
import com.aarogyam.staff.api.patientIntake
import com.aarogyam.staff.api.setPatientIntake
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What the "case-paper details" editor of an existing patient draws. */
sealed interface IntakeEditState {
    data object Loading : IntakeEditState

    /** The role lacks `patients.write`; nothing was requested. */
    data object NotAllowed : IntakeEditState

    data class Failed(
        val error: ScreenError,
    ) : IntakeEditState

    /**
     * [masked] holds the phones the server hid (the role lacks `patients.contact`): shown as they came, read-only,
     * and sent back unchanged. Patient data: shown on screen only, never logged.
     */
    data class Editing(
        val details: IntakeDetails,
        val masked: Map<DetailField, String>,
        val options: IntakeOptions?,
        val female: Boolean,
        val errors: Map<IntakeField, IntakeProblem> = emptyMap(),
        val saving: Boolean = false,
        val saved: Boolean = false,
        val saveError: ScreenError? = null,
    ) : IntakeEditState
}

/** Reads and saves one patient's case-paper fields (`GET` and `PUT /patients/{id}/intake`). [female] shows the women's questions. */
class IntakeEditHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val female: Boolean,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.intakeedit"),
) {
    private val allowed = "patients.write" in clinic.permissions
    private val mutable =
        MutableStateFlow<IntakeEditState>(if (allowed) IntakeEditState.Loading else IntakeEditState.NotAllowed)
    val state: StateFlow<IntakeEditState> = mutable.asStateFlow()

    init {
        if (allowed) load()
    }

    fun refresh() {
        if (!allowed) return
        mutable.value = IntakeEditState.Loading
        load()
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.patientIntake(patientId)) {
                is Outcome.Success -> {
                    val (details, masked) = result.value.toDetails()
                    val options = (clinic.api.intakeOptions() as? Outcome.Success)?.value
                    mutable.value = IntakeEditState.Editing(details, masked, options, female)
                }

                is Outcome.Failure -> {
                    log.warn("intakeedit.load_failed") { code("error", result.error.code.value) }
                    mutable.value = IntakeEditState.Failed(ScreenError.of(result.error))
                }
            }
        }
    }

    /** Types into or picks a field; a masked phone cannot be changed. */
    fun setDetail(
        field: DetailField,
        text: String,
    ) = edit {
        if (field in
            masked
        ) {
            this
        } else {
            copy(
                details = details.with(field, text),
                errors =
                    errors - listOfNotNull(field.errorKey()).toSet(),
            )
        }
    }

    fun setPregnant(value: Boolean?) = edit { copy(details = details.withPregnant(value)) }

    fun setNursing(value: Boolean?) = edit { copy(details = details.copy(nursing = value)) }

    fun save() {
        val now = mutable.value as? IntakeEditState.Editing ?: return
        if (now.saving) return
        val problems = now.details.problems(now.female)
        if (problems.isNotEmpty()) return edit { copy(errors = problems, saved = false) }
        edit { copy(errors = emptyMap(), saving = true, saved = false, saveError = null) }
        scope.launch {
            // Everything shown goes back; a masked phone goes back exactly as it came.
            val body =
                now.details.toApi(now.female, now.masked) ?: com.aarogyam.staff.api.model
                    .PatientIntake()
            when (val result = clinic.api.setPatientIntake(patientId, body)) {
                is Outcome.Success -> {
                    log.info("intakeedit.saved") { id("patient_id", patientId) }
                    edit { copy(saving = false, saved = true) }
                }

                is Outcome.Failure -> {
                    log.warn("intakeedit.save_failed") { code("error", result.error.code.value) }
                    edit { copy(saving = false, saveError = ScreenError.of(result.error)) }
                }
            }
        }
    }

    private fun edit(change: IntakeEditState.Editing.() -> IntakeEditState.Editing) =
        mutable.update { (it as? IntakeEditState.Editing)?.change() ?: it }
}

private fun DetailField.errorKey(): IntakeField? =
    when (this) {
        DetailField.AltPhone -> IntakeField.AltPhone
        DetailField.EmergencyPhone -> IntakeField.EmergencyPhone
        DetailField.DoctorPhone -> IntakeField.DoctorPhone
        DetailField.DueDate -> IntakeField.DueDate
        else -> null
    }
