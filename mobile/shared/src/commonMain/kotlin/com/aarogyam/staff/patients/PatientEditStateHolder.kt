package com.aarogyam.staff.patients

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.PatientAddress
import com.aarogyam.staff.api.model.PatientChanges
import com.aarogyam.staff.api.updatePatient
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.walkin.AddressField
import com.aarogyam.staff.walkin.AddressForm
import com.aarogyam.staff.walkin.PincodeAutofill
import com.aarogyam.staff.walkin.wire
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate

/** Why "Save" did not send; each platform maps these to copy. */
enum class PatientEditProblem { NameRequired, BirthDateInvalid, AgeInvalid, Changed }

/** The edit form as typed. Patient data: shown on screen only, never logged. */
data class PatientEditForm(
    val name: String,
    val phone: String,
    val sex: Sex?,
    /** `YYYY-MM-DD` or empty. */
    val birthDate: String,
    /** Years, used only when there is no date of birth. */
    val age: String,
    val address: AddressForm,
    /** Phone is editable only with `patients.contact` (it is masked otherwise). */
    val canEditPhone: Boolean,
    val saving: Boolean = false,
    val problem: PatientEditProblem? = null,
    val error: ScreenError? = null,
    val saved: Boolean = false,
)

/**
 * "Edit details" on Patient 360: name, phone, sex, date of birth (or age) and the optional address
 * (`PATCH /patients/{id}`, patients.write). The record's `row_version` guards against a stale edit.
 */
class PatientEditStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val start: PatientView,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patientedit"),
) {
    private val canContact = "patients.contact" in clinic.permissions
    private val mutable =
        MutableStateFlow(
            PatientEditForm(
                name = start.name,
                phone = if (canContact) start.phone.orEmpty() else "",
                sex = start.sex.takeIf { it != Sex.Unknown },
                birthDate = start.dateOfBirth.orEmpty(),
                age = if (start.dateOfBirth == null) start.ageYears?.toString().orEmpty() else "",
                address = start.address ?: AddressForm(),
                canEditPhone = canContact,
            ),
        )

    val state: StateFlow<PatientEditForm> = mutable.asStateFlow()

    private val autofill =
        PincodeAutofill(clinic.api, scope, log) { change -> edit { copy(address = change(address)) } }

    fun setName(text: String) = edit { copy(name = text, problem = null) }

    fun setPhone(text: String) = edit { copy(phone = text) }

    fun setSex(value: Sex) = edit { copy(sex = if (sex == value) null else value) }

    fun setBirthDate(text: String) =
        edit {
            copy(birthDate = text.filter { it.isDigit() || it == '-' }.take(DATE_LENGTH), problem = null)
        }

    fun setAge(text: String) = edit { copy(age = text.filter { it.isDigit() }.take(AGE_DIGITS), problem = null) }

    /** Types into one part of the address; a full PIN fills district and state. */
    fun setAddress(
        field: AddressField,
        text: String,
    ) {
        edit { copy(address = address.with(field, text)) }
        if (field == AddressField.Pincode) autofill.typed(AddressForm().with(field, text).pincode)
    }

    /** Validates, then sends one request; a second tap while saving is ignored. */
    fun save() {
        val form = mutable.value
        if (form.saving || "patients.write" !in clinic.permissions) return
        val changes =
            when (val built = changes(form)) {
                is Built.Problem -> return edit { copy(problem = built.problem) }
                is Built.Ok -> built.changes
            }
        edit { copy(saving = true, problem = null, error = null) }
        scope.launch {
            when (val result = clinic.api.updatePatient(patientId, start.rowVersion, changes)) {
                is Outcome.Success -> {
                    log.info("patient.edited") { id("patient_id", patientId) }
                    edit { copy(saving = false, saved = true) }
                }

                is Outcome.Failure -> {
                    log.warn("patient.edit_failed") { code("error", result.error.code.value) }
                    val stale = result.error.kind == ApiErrorKind.PreconditionFailed
                    edit {
                        copy(
                            saving = false,
                            problem = if (stale) PatientEditProblem.Changed else null,
                            error = if (stale) null else ScreenError.of(result.error),
                        )
                    }
                }
            }
        }
    }

    private sealed interface Built {
        data class Problem(
            val problem: PatientEditProblem,
        ) : Built

        data class Ok(
            val changes: PatientChanges,
        ) : Built
    }

    private fun changes(form: PatientEditForm): Built {
        val name = form.name.trim()
        if (name.isEmpty()) return Built.Problem(PatientEditProblem.NameRequired)
        val birth = form.birthDate.trim()
        if (birth.isNotEmpty() && runCatching { LocalDate.parse(birth) }.isFailure) {
            return Built.Problem(PatientEditProblem.BirthDateInvalid)
        }
        val age = form.age.toIntOrNull()
        if (birth.isEmpty() && form.age.isNotEmpty() && (age == null || age > MAX_AGE)) {
            return Built.Problem(PatientEditProblem.AgeInvalid)
        }
        // An address with every part empty clears the stored one; with none stored, leave it out.
        val address =
            form.address.toApi()
                ?: if (start.address !=
                    null
                ) {
                    PatientAddress(line1 = "", locality = "", city = "", district = "", state = "", pincode = "")
                } else {
                    null
                }
        return Built.Ok(
            PatientChanges(
                fullName = name,
                sex = form.sex?.wire(),
                // Empty clears; a date wins over an age.
                dateOfBirth = if (birth.isNotEmpty() || start.dateOfBirth != null) birth else null,
                ageYears = if (birth.isEmpty() && start.dateOfBirth == null) age else null,
                phone = if (canContact && form.phone.trim() != start.phone.orEmpty()) form.phone.trim() else null,
                address = address,
            ),
        )
    }

    private fun edit(change: PatientEditForm.() -> PatientEditForm) = mutable.update { it.change() }

    private companion object {
        const val DATE_LENGTH = 10
        const val AGE_DIGITS = 3
        const val MAX_AGE = 130
    }
}
