package com.aarogyam.staff.consents

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.consentNotices
import com.aarogyam.staff.api.consents
import com.aarogyam.staff.api.model.Consent
import com.aarogyam.staff.api.model.ConsentNotice
import com.aarogyam.staff.api.model.RecordConsent
import com.aarogyam.staff.api.model.WithdrawConsent
import com.aarogyam.staff.api.recordConsent
import com.aarogyam.staff.api.withdrawConsent
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class ConsentPurpose(
    val wire: String,
) {
    Care("care"),
    Reminders("reminders"),
    Promotional("promotional"),
    Sharing("sharing"),
    Research("research"),
}

enum class ConsentMethod(
    val wire: String,
) {
    Paper("paper"),
    Verbal("verbal"),
    App("app"),
}

/** One consent row; [purpose] is null for a purpose this build does not know. */
data class ConsentView(
    val id: String,
    val purpose: ConsentPurpose?,
    val purposeKey: String,
    val noticeVersion: String,
    val method: ConsentMethod?,
    val givenAt: ClinicMoment?,
    val recordedBy: String,
    val withdrawnAt: ClinicMoment?,
    val withdrawnBy: String?,
    val note: String?,
) {
    val withdrawn: Boolean get() = withdrawnAt != null
}

data class NoticeView(
    val id: String,
    val version: Int,
    val label: String,
    val body: String,
)

/** The input of a failed [ConsentsStateHolder.record], kept so the sheet reopens filled. */
data class RecordAttempt(
    val purpose: ConsentPurpose,
    val method: ConsentMethod,
    val note: String?,
    val error: ScreenError,
)

sealed interface ConsentsState {
    data object Loading : ConsentsState

    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : ConsentsState

    data class Failed(
        val error: ScreenError,
    ) : ConsentsState

    /** [active] and [withdrawn] are newest first. */
    data class Loaded(
        val active: List<ConsentView>,
        val withdrawn: List<ConsentView>,
        val notices: List<NoticeView>,
        val canRecord: Boolean,
        val canWithdraw: Boolean,
        val busy: Boolean = false,
        val failedRecord: RecordAttempt? = null,
        val error: ScreenError? = null,
        val refreshing: Boolean = false,
    ) : ConsentsState
}

/** A patient's consents: list, current notices, record and withdraw. */
class ConsentsStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.consents"),
) {
    private val mutableState = MutableStateFlow<ConsentsState>(ConsentsState.Loading)
    val state: StateFlow<ConsentsState> = mutableState.asStateFlow()

    /** Kept across a failed record so a retry carries the same key; cleared on success. */
    private var pendingKey: IdempotencyKey? = null

    init {
        if (PATIENTS_READ in clinic.permissions) refresh() else mutableState.value = ConsentsState.NotAllowed
    }

    fun refresh() {
        val current = mutableState.value
        if (current is ConsentsState.NotAllowed) return
        if (current is ConsentsState.Loaded) {
            if (current.refreshing) return
            mutableState.value = current.copy(refreshing = true, error = null)
        } else {
            mutableState.value = ConsentsState.Loading
        }
        scope.launch {
            val list = async { clinic.api.consents(patientId) }
            val notices = async { clinic.api.consentNotices() }
            val result = list.await()
            val noticeResult = notices.await()
            val now = mutableState.value
            if (result is Outcome.Success) {
                val items = result.value.items
                val keep = now as? ConsentsState.Loaded
                mutableState.value =
                    ConsentsState.Loaded(
                        active = items.filter { it.status != WITHDRAWN }.map { it.view() },
                        withdrawn = items.filter { it.status == WITHDRAWN }.map { it.view() },
                        notices =
                            (noticeResult as? Outcome.Success)?.value?.items?.map { it.view() }
                                ?: keep?.notices.orEmpty(),
                        canRecord = PATIENTS_WRITE in clinic.permissions,
                        canWithdraw = PATIENTS_WRITE in clinic.permissions,
                        failedRecord = keep?.failedRecord,
                    )
            } else if (result is Outcome.Failure) {
                log.warn("consents.load_failed") { id("patient", patientId) }
                val error = ScreenError.of(result.error)
                mutableState.value =
                    if (now is ConsentsState.Loaded) now.copy(refreshing = false, error = error) else ConsentsState.Failed(error)
            }
        }
    }

    /** Records a consent. On failure the input stays in [ConsentsState.Loaded.failedRecord]. */
    fun record(
        purpose: ConsentPurpose,
        method: ConsentMethod,
        note: String? = null,
    ) {
        val current = mutableState.value as? ConsentsState.Loaded ?: return
        if (!current.canRecord) {
            mutableState.value = current.copy(error = ScreenError.NotAllowed)
            return
        }
        if (current.busy) return
        val key = pendingKey ?: IdempotencyKey.generate().also { pendingKey = it }
        mutableState.value = current.copy(busy = true, error = null, failedRecord = null)
        scope.launch {
            val body = RecordConsent(purpose = purpose.wire, method = method.wire, note = note?.takeIf { it.isNotBlank() })
            when (val result = clinic.api.recordConsent(patientId, body, key)) {
                is Outcome.Success -> {
                    pendingKey = null
                    mutableState.value = (mutableState.value as ConsentsState.Loaded).copy(busy = false)
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("consents.record_failed") { id("patient", patientId) }
                    val error = ScreenError.of(result.error)
                    // 409: already active, so the first attempt landed; show the server's list.
                    val conflict = result.error.kind == ApiErrorKind.Conflict
                    if (conflict) pendingKey = null
                    val now = mutableState.value as ConsentsState.Loaded
                    mutableState.value =
                        now.copy(
                            busy = false,
                            failedRecord = if (conflict) null else RecordAttempt(purpose, method, note, error),
                            error = error,
                        )
                    if (conflict) refresh()
                }
            }
        }
    }

    /** Records that the patient withdrew [consentId]. */
    fun withdraw(
        consentId: String,
        method: ConsentMethod,
        note: String? = null,
    ) {
        val current = mutableState.value as? ConsentsState.Loaded ?: return
        if (!current.canWithdraw) {
            mutableState.value = current.copy(error = ScreenError.NotAllowed)
            return
        }
        if (current.busy) return
        mutableState.value = current.copy(busy = true, error = null)
        scope.launch {
            val body = WithdrawConsent(method = method.wire, note = note?.takeIf { it.isNotBlank() })
            when (val result = clinic.api.withdrawConsent(consentId, body)) {
                is Outcome.Success -> {
                    mutableState.value = (mutableState.value as ConsentsState.Loaded).copy(busy = false)
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("consents.withdraw_failed") { id("consent", consentId) }
                    val now = mutableState.value as ConsentsState.Loaded
                    mutableState.value = now.copy(busy = false, error = ScreenError.of(result.error))
                    if (result.error.kind == ApiErrorKind.Conflict) refresh()
                }
            }
        }
    }

    fun clearError() {
        val current = mutableState.value as? ConsentsState.Loaded ?: return
        mutableState.value = current.copy(error = null, failedRecord = null)
        pendingKey = null
    }

    private fun Consent.view() =
        ConsentView(
            id = id,
            purpose = ConsentPurpose.entries.firstOrNull { it.wire == purpose },
            purposeKey = purpose,
            noticeVersion = noticeVersion,
            method = ConsentMethod.entries.firstOrNull { it.wire == method },
            givenAt = moment(givenAt, clinic.timeZone),
            recordedBy = recordedBy,
            withdrawnAt = withdrawnAt?.let { moment(it, clinic.timeZone) },
            withdrawnBy = withdrawnBy,
            note = note,
        )

    private fun ConsentNotice.view() = NoticeView(id, version, label, body)

    private companion object {
        const val PATIENTS_READ = "patients.read"
        const val PATIENTS_WRITE = "patients.write"
        const val WITHDRAWN = "withdrawn"
    }
}
