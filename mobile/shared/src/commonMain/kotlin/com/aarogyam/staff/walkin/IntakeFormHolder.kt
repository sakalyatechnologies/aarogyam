package com.aarogyam.staff.walkin

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.consentNotices
import com.aarogyam.staff.api.registerWalkIn
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.FamilyOfBody
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.outbox.OUTBOX_FILES_MAX_BYTES
import com.aarogyam.staff.outbox.OutboxFiles
import com.aarogyam.staff.outbox.OutboxFullException
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.PatientFileJob
import com.aarogyam.staff.outbox.Refusal
import com.aarogyam.staff.outbox.queueJson
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.todayIn
import kotlinx.serialization.encodeToString
import kotlin.time.Clock

/**
 * The v10 new-patient intake: one form, one `POST /walk-ins` (online only), then the photo and the
 * signature are queued as `PatientFile` entries. Fields for `reason` and `family_of` show only when
 * their [ServerCaps] flag is on ([IntakeForm.showReason], [IntakeForm.showFamily]).
 */
interface IntakeFormHolder {
    val state: StateFlow<IntakeForm>

    /** The phone typed in the lookup, prefilled; digits only (a `+91` or trunk `0` drops out). */
    fun setPhone(typed: String)

    fun setName(text: String)

    /** `YYYY-MM-DD` typed or picked; clears the age. */
    fun setDateOfBirth(text: String)

    /** Age in years (digits only); used when the date of birth is unknown. */
    fun setAge(text: String)

    fun setEmail(text: String)

    fun setSex(value: Sex)

    fun toggleAllergy(label: String)

    fun toggleNoKnownAllergies()

    /** The desk read the notice aloud and the patient agreed to care and keeping their record. */
    fun setReadAloud(on: Boolean)

    fun setReminders(on: Boolean)

    /** The signature pad's PNG, or null when cleared. */
    fun setSignature(png: ByteArray?)

    /** The optional profile photo (JPEG, already resized), or null to remove it. */
    fun setPhoto(jpeg: ByteArray?)

    fun setPractitioner(id: String?)

    fun setReason(text: String)

    fun setFamilyOf(
        patientId: String?,
        relation: String,
    )

    /** Validates, then sends one request and queues the files. A second tap while sending is ignored. */
    fun saveAndQueue()

    /** A clean form for the next patient, keeping the reference data. */
    fun reset()
}

/**
 * What the form needs from the app that the factory signature does not carry: the outbox, its
 * files and whether the phone is online. `AppGraph` installs it once (see docs/plans/v10/t3.md).
 */
object IntakeDeps {
    internal var runner: OutboxRunner? = null
    internal var files: OutboxFiles? = null
    internal var online: () -> Boolean = { false }

    fun install(
        runner: OutboxRunner,
        files: OutboxFiles,
        online: () -> Boolean,
    ) {
        this.runner = runner
        this.files = files
        this.online = online
    }
}

internal fun createIntakeForm(
    clinic: ClinicContext,
    scope: CoroutineScope,
): IntakeFormHolder = IntakeFormStateHolder(clinic, scope)

internal class IntakeFormStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.intake"),
    private val online: () -> Boolean = { IntakeDeps.online() },
    private val runner: () -> OutboxRunner? = { IntakeDeps.runner },
    private val files: () -> OutboxFiles? = { IntakeDeps.files },
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) : IntakeFormHolder {
    private val mutable = MutableStateFlow(IntakeForm())
    override val state: StateFlow<IntakeForm> = mutable.asStateFlow()

    // The file bytes are held here, not in the observable state.
    private var signature: ByteArray? = null
    private var photo: ByteArray? = null

    init {
        // G6 shipped `reason` on `POST /walk-ins`; it is in the spec, so the field is on.
        ServerCaps.markWalkInReason()
        refreshFlags()
        scope.launch { loadReference() }
    }

    override fun setPhone(typed: String) = edit { copy(phone = mobileDigits(typed)).clear(IntakeField.Phone) }

    override fun setName(text: String) = edit { copy(name = text).clear(IntakeField.Name) }

    override fun setDateOfBirth(text: String) =
        edit {
            copy(dateOfBirth = text.filter { it.isDigit() || it == '-' }.take(DATE_LENGTH), age = "")
                .clear(IntakeField.Birth)
        }

    override fun setAge(text: String) =
        edit { copy(age = text.filter { it.isDigit() }.take(AGE_DIGITS), dateOfBirth = "").clear(IntakeField.Birth) }

    override fun setEmail(text: String) = edit { copy(email = text).clear(IntakeField.Email) }

    override fun setSex(value: Sex) = edit { copy(sex = if (sex == value) null else value) }

    override fun toggleAllergy(label: String) =
        edit {
            copy(
                allergies = if (label in allergies) allergies - label else allergies + label,
                noKnownAllergies = false,
            ).clear(IntakeField.Allergies)
        }

    override fun toggleNoKnownAllergies() =
        edit { copy(noKnownAllergies = !noKnownAllergies, allergies = emptySet()).clear(IntakeField.Allergies) }

    override fun setReadAloud(on: Boolean) = edit { copy(readAloud = on).clear(IntakeField.Consent) }

    override fun setReminders(on: Boolean) = edit { copy(reminders = on) }

    override fun setSignature(png: ByteArray?) {
        signature = png?.takeIf { it.isNotEmpty() }
        edit { copy(signaturePresent = signature != null).clear(IntakeField.Signature) }
    }

    override fun setPhoto(jpeg: ByteArray?) {
        photo = jpeg?.takeIf { it.isNotEmpty() }
        edit { copy(photoPresent = photo != null) }
    }

    override fun setPractitioner(id: String?) = edit { copy(practitionerId = id) }

    override fun setReason(text: String) = edit { copy(reason = text.take(MAX_REASON)).clear(IntakeField.Reason) }

    override fun setFamilyOf(
        patientId: String?,
        relation: String,
    ) = edit { copy(familyOf = patientId?.let { FamilyOf(it, relation) }) }

    override fun saveAndQueue() {
        refreshFlags()
        val form = mutable.value
        if (form.submitting || form.done != null) return
        val errors = validate(form, today())
        if (errors.isNotEmpty()) return edit { copy(errors = errors, submitError = null) }
        // Online only (R3): offline queues nothing and keeps the form.
        if (!online()) return edit { copy(errors = emptyMap(), submitError = IntakeSubmitError.NeedsConnection) }
        val runner = runner()
        val files = files()
        if (runner == null || files == null) return edit { copy(submitError = IntakeSubmitError.NotWired) }
        val request = buildRequest(form)
        edit { copy(errors = emptyMap(), submitError = null, submitting = true) }
        scope.launch {
            val family = form.familyOf?.takeIf { ServerCaps.family }?.let { FamilyOfBody(it.patientId, it.relation) }
            when (val result = clinic.api.registerWalkIn(request, family)) {
                is Outcome.Success -> {
                    val done = result.value
                    log.info("intake.registered") {
                        id("patient_id", done.patient.id)
                        id("queue_token_id", done.token.id)
                    }
                    val queued = queueFiles(runner, files, done.patient.id)
                    clearBytes()
                    edit {
                        copy(
                            submitting = false,
                            done =
                                IntakeDone(
                                    done.patient.id,
                                    done.token.id,
                                    done.token.tokenNumber,
                                    queued.first,
                                    queued.second,
                                ),
                        )
                    }
                }

                is Outcome.Failure -> {
                    log.warn("intake.register_failed") { code("error", result.error.code.value) }
                    val error = IntakeSubmitError.Server(ScreenError.of(result.error))
                    edit { copy(submitting = false, submitError = error) }
                }
            }
        }
    }

    override fun reset() {
        clearBytes()
        val old = mutable.value
        mutable.value = IntakeForm(doctors = old.doctors, allergyPicks = old.allergyPicks, notice = old.notice)
        refreshFlags()
    }

    /** The one request: the existing walk-in builder, plus what the intake adds. */
    private fun buildRequest(form: IntakeForm): com.aarogyam.staff.api.model.WalkInRequest {
        val legacy =
            WalkInForm(
                mobile = form.phone,
                who = Who.New,
                name = form.name,
                age = if (form.dateOfBirth.isEmpty()) form.age else "",
                sex = form.sex,
                allergies = form.allergies,
                noKnownAllergies = form.noKnownAllergies,
                reminders = form.reminders,
                doctorId = form.practitionerId,
            )
        val built = (walkInRequest(legacy) as Result.Ok).value
        val patient = built.patient!!
        return built.copy(
            patient =
                patient.copy(
                    dateOfBirth = form.dateOfBirth.takeIf { it.isNotEmpty() },
                    email = form.email.trim().takeIf { it.isNotEmpty() },
                ),
            noticeId = form.notice?.id,
            reason = form.reason.trim().takeIf { ServerCaps.walkInReason && it.isNotEmpty() },
        )
    }

    /** Photo "Profile" (`photo`), then signature "Signature" (`consent`): how many were saved, and why one was not. */
    private fun queueFiles(
        runner: OutboxRunner,
        files: OutboxFiles,
        patientId: String,
    ): Pair<Int, Refusal?> {
        var saved = 0
        var refused: Refusal? = null
        val items =
            listOf(Triple(photo, "photo" to "Profile", "jpg"), Triple(signature, "consent" to "Signature", "png"))
        items.forEach { (bytes, what, ext) ->
            if (bytes == null) return@forEach
            val id = IdempotencyKey.generate().toString()
            val name = "$id.$ext"
            if (files.totalBytes() + bytes.size > OUTBOX_FILES_MAX_BYTES) {
                refused = Refusal.FilesFull
                return@forEach
            }
            files.write(name, bytes)
            try {
                val job = PatientFileJob(clinic.slug, patientId, what.first, what.second)
                runner.enqueue(OutboxKind.PatientFile, queueJson.encodeToString(job), id, fileName = name)
                saved++
            } catch (_: OutboxFullException) {
                runCatching { files.delete(name) }
                refused = Refusal.QueueFull
            }
        }
        return saved to refused
    }

    private suspend fun loadReference() {
        val (doctors, picks) = loadWalkInReference(clinic)
        val notice =
            (clinic.api.consentNotices() as? Outcome.Success)?.value?.items?.firstOrNull()?.let {
                IntakeNotice(it.id, it.version, it.label, it.body)
            }
        edit { copy(doctors = doctors, allergyPicks = picks, notice = notice) }
    }

    private fun clearBytes() {
        signature = null
        photo = null
    }

    private fun refreshFlags() = edit { copy(showReason = ServerCaps.walkInReason, showFamily = ServerCaps.family) }

    private fun edit(change: IntakeForm.() -> IntakeForm) = mutable.update { it.change() }

    private fun IntakeForm.clear(field: IntakeField) = copy(errors = errors - field)

    private companion object {
        const val DATE_LENGTH = 10
        const val AGE_DIGITS = 3
        const val MAX_REASON = 200
    }
}

private const val MIN_NAME = 2
private const val MAX_AGE = 120
private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

/** Per-field problems; empty when the form can be sent. */
internal fun validate(
    form: IntakeForm,
    today: LocalDate,
): Map<IntakeField, IntakeProblem> =
    buildMap {
        if (form.name.trim().length < MIN_NAME) put(IntakeField.Name, IntakeProblem.Required)
        if (form.phone.isNotEmpty() && !isCompleteMobile(form.phone)) put(IntakeField.Phone, IntakeProblem.Invalid)
        if (form.email.isNotBlank() && !EMAIL.matches(form.email.trim())) put(IntakeField.Email, IntakeProblem.Invalid)
        birthProblem(form, today)?.let { put(IntakeField.Birth, it) }
        if (!form.noKnownAllergies && form.allergies.isEmpty()) put(IntakeField.Allergies, IntakeProblem.Required)
        if (!form.readAloud) put(IntakeField.Consent, IntakeProblem.Required)
        if (!form.signaturePresent) put(IntakeField.Signature, IntakeProblem.Required)
    }

private fun birthProblem(
    form: IntakeForm,
    today: LocalDate,
): IntakeProblem? {
    if (form.dateOfBirth.isNotEmpty()) {
        val date = runCatching { LocalDate.parse(form.dateOfBirth) }.getOrNull() ?: return IntakeProblem.Invalid
        return if (date > today) IntakeProblem.InFuture else null
    }
    val age = form.age.toIntOrNull() ?: return IntakeProblem.Required
    return if (age > MAX_AGE) IntakeProblem.Invalid else null
}
