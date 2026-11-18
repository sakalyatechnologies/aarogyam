package com.aarogyam.staff.consents

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.attachmentLink
import com.aarogyam.staff.api.setConsentSignature
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The signed paper form of a consent: being attached, or a link to open it once. */
data class ConsentFormsState(
    /** The consent whose form is going up. */
    val attaching: String? = null,
    val error: ScreenError? = null,
    /** A five-minute link to a signed form, for the screen to open once ([ConsentFormsHolder.close]). */
    val link: String? = null,
    val opening: Boolean = false,
)

/**
 * "Add signed form" and "View signed form" on a consent: a photo of the paper (a JPEG resized on
 * the phone) uploads as a `consent` file of the patient, then `PUT .../consents/{id}/signature`
 * links it. [onLinked] reloads the consents so the row shows the form.
 */
class ConsentFormsHolder internal constructor(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger,
    private val onLinked: () -> Unit,
) {
    private val mutableState = MutableStateFlow(ConsentFormsState())
    val state: StateFlow<ConsentFormsState> = mutableState.asStateFlow()

    /** Uploads [jpeg] as the signed form of [consentId]; needs `patients.write`. */
    fun attach(
        consentId: String,
        jpeg: ByteArray,
    ) {
        if (PATIENTS_WRITE !in clinic.permissions || mutableState.value.attaching != null || jpeg.isEmpty()) return
        mutableState.update { it.copy(attaching = consentId, error = null) }
        scope.launch {
            val fileId = IdempotencyKey.generate().toString()
            val up = clinic.api.uploadAttachment(patientId, fileId, KIND, jpeg, null, null)
            val linked =
                when (up) {
                    is Outcome.Success -> clinic.api.setConsentSignature(patientId, consentId, up.value.id)
                    is Outcome.Failure -> up
                }
            when (linked) {
                is Outcome.Success -> {
                    log.info("consents.form_attached") { id("consent", consentId) }
                    mutableState.update { it.copy(attaching = null) }
                    onLinked()
                }

                is Outcome.Failure -> {
                    log.warn("consents.form_failed") {
                        id("consent", consentId)
                        code("error", linked.error.code.value)
                    }
                    mutableState.update { it.copy(attaching = null, error = ScreenError.of(linked.error)) }
                }
            }
        }
    }

    /** Fetches a five-minute link to the signed form [attachmentId] for the screen to open. */
    fun open(attachmentId: String) {
        if (mutableState.value.opening) return
        mutableState.update { it.copy(opening = true, error = null, link = null) }
        scope.launch {
            when (val answer = clinic.api.attachmentLink(attachmentId)) {
                is Outcome.Success -> {
                    val path = answer.value.url
                    val url = if (path.startsWith("/")) clinic.api.origin + path else path
                    mutableState.update { it.copy(opening = false, link = url) }
                }

                is Outcome.Failure -> {
                    log.warn("consents.form_link_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(opening = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** The screen opened the link, or showed the error; neither is kept. */
    fun close() = mutableState.update { it.copy(link = null, error = null) }

    private companion object {
        const val KIND = "consent"
        const val PATIENTS_WRITE = "patients.write"
    }
}
