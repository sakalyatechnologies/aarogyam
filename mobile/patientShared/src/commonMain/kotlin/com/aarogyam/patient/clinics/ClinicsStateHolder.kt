package com.aarogyam.patient.clinics

import com.aarogyam.patient.ClinicView
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.view
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Why adding a clinic didn't work. */
enum class LinkError {
    /** Not 10 letters and digits. */
    InvalidCode,

    /** No such code, used or expired. */
    CodeNotFound,

    /** The account is linked to another record at that clinic. */
    OtherRecord,

    /** Another account holds that record. */
    RecordTaken,

    /** No clinic named. */
    NoClinic,
    TooManyAttempts,
    Offline,
    Failed,
}

/**
 * My clinics: the linked clinics, a code the clinic gave to add one, or a request the clinic
 * confirms. [linked] is the clinic a code just added; [requested] is true after a request was sent
 * (the answer never says whether the clinic has a record).
 */
data class ClinicsState(
    val loading: Boolean = true,
    val clinics: List<ClinicView> = emptyList(),
    val error: ScreenError? = null,
    val code: String = "",
    val clinicSlug: String = "",
    val busy: Boolean = false,
    val linkError: LinkError? = null,
    val linked: ClinicView? = null,
    val requested: Boolean = false,
)

/** My clinics and adding one: `GET /me/patient`, `POST /me/patient/links`, `POST /me/patient/link-requests`. */
class ClinicsStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient.clinics"),
) {
    private val mutableState = MutableStateFlow(ClinicsState())

    /** The current screen state. */
    val state: StateFlow<ClinicsState> = mutableState.asStateFlow()

    init {
        load(refresh = false)
    }

    /** Reloads the clinics from the API. */
    fun refresh() = load(refresh = true)

    fun onCodeChange(text: String) =
        mutableState.update {
            it.copy(
                code =
                    text
                        .uppercase()
                        .filter { c ->
                            c.isLetterOrDigit() || c == '-'
                        }.take(CODE_INPUT),
                linkError = null,
            )
        }

    fun onClinicChange(text: String) =
        mutableState.update {
            it.copy(clinicSlug = text.trim().lowercase().take(SLUG_MAX), linkError = null, requested = false)
        }

    /** Redeems the code; on success the clinic appears in the list. */
    fun submitCode() {
        val current = mutableState.value
        if (current.busy) return
        val code = current.code.filter(Char::isLetterOrDigit)
        if (code.length != CODE_LENGTH) return mutableState.update { it.copy(linkError = LinkError.InvalidCode) }
        mutableState.update { it.copy(busy = true, linkError = null, linked = null) }
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value

                    is Outcome.Failure -> return@launch mutableState.update {
                        it.copy(
                            busy = false,
                            linkError = LinkError.Failed,
                        )
                    }
                }
            when (val linked = api.redeem(code)) {
                is Outcome.Success -> {
                    log.info("patient.linked") { id("clinic", linked.value.clinicId) }
                    val me = directory.load(refresh = true)
                    val clinics = (me as? Outcome.Success)?.value?.clinics?.map { it.view() } ?: current.clinics
                    mutableState.update {
                        it.copy(
                            busy = false,
                            code = "",
                            clinics = clinics,
                            linked = clinics.firstOrNull { c -> c.id == linked.value.clinicId },
                        )
                    }
                }

                is Outcome.Failure -> {
                    mutableState.update { it.copy(busy = false, linkError = linkError(linked.error)) }
                }
            }
        }
    }

    /** Asks the clinic named by its address (such as `sunrise`) to confirm the record with the patient's email. */
    fun submitRequest() {
        val current = mutableState.value
        if (current.busy) return
        if (current.clinicSlug.isBlank()) return mutableState.update { it.copy(linkError = LinkError.NoClinic) }
        mutableState.update { it.copy(busy = true, linkError = null, requested = false) }
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value

                    is Outcome.Failure -> return@launch mutableState.update {
                        it.copy(
                            busy = false,
                            linkError = LinkError.Failed,
                        )
                    }
                }
            when (val sent = api.requestLink(current.clinicSlug)) {
                is Outcome.Success -> mutableState.update { it.copy(busy = false, requested = true, clinicSlug = "") }
                is Outcome.Failure -> mutableState.update { it.copy(busy = false, linkError = linkError(sent.error)) }
            }
        }
    }

    /** Clears the "added" message. */
    fun dismissLinked() = mutableState.update { it.copy(linked = null, requested = false) }

    private fun load(refresh: Boolean) {
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            when (val me = directory.load(refresh)) {
                is Outcome.Success -> {
                    mutableState.update {
                        it.copy(
                            loading = false,
                            clinics =
                                me.value.clinics.map { c ->
                                    c.view()
                                },
                        )
                    }
                }

                is Outcome.Failure -> {
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(me.error)) }
                }
            }
        }
    }

    private fun linkError(error: ApiError): LinkError =
        when {
            error.kind == ApiErrorKind.TooManyRequests -> LinkError.TooManyAttempts
            error.kind == ApiErrorKind.Transport -> LinkError.Offline
            error.kind == ApiErrorKind.BadRequest -> LinkError.InvalidCode
            error.kind == ApiErrorKind.NotFound -> LinkError.CodeNotFound
            error.code.value == "other_record" -> LinkError.OtherRecord
            error.code.value == "record_linked" -> LinkError.RecordTaken
            else -> LinkError.Failed
        }

    private companion object {
        const val CODE_LENGTH = 10
        const val CODE_INPUT = 11
        const val SLUG_MAX = 63
    }
}
