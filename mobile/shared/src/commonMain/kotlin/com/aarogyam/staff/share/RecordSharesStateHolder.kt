package com.aarogyam.staff.share

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.createRecordShare
import com.aarogyam.staff.api.recordShares
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

/** What a record link can show; [permission] is what the role needs for it. */
enum class RecordKind(
    val wire: String,
    val permission: String,
) {
    Chart("chart", "clinical.read"),
    Xrays("xrays", "clinical.read"),
    Bills("bills", "billing.read"),
}

/** How long a link works. */
enum class ShareExpiry(
    val wire: String,
) {
    Hour("1h"),
    Day("24h"),
    Week("7d"),
}

/** Whether a listed link still opens: the API's `usable`, `expired` (past expiry or revoked) or `locked` (wrong PINs). */
enum class ShareLinkState { Usable, Expired, Locked }

/** One link in the list; never its token or PIN. */
data class ShareRow(
    val id: String,
    val kinds: List<RecordKind>,
    val state: ShareLinkState,
    val expiresOn: LocalDate?,
    val openCount: Int,
)

/** The make-a-link step: idle, busy, failed, or [Ready] with the link and PIN, shown once. */
sealed interface SharePhase {
    data object Idle : SharePhase

    data object Creating : SharePhase

    data class Failed(
        val error: ScreenError,
    ) : SharePhase

    data class Ready(
        val url: String,
        val pin: String,
        val expiresOn: LocalDate?,
    ) : SharePhase
}

/** [kinds] are the ones this role may share; [selected] the ones ticked. */
data class RecordSharesState(
    val allowed: Boolean,
    val kinds: List<RecordKind>,
    val selected: Set<RecordKind>,
    val expiry: ShareExpiry = ShareExpiry.Week,
    val phase: SharePhase = SharePhase.Idle,
    val links: List<ShareRow> = emptyList(),
    val linksError: ScreenError? = null,
)

/**
 * "Share record" on Patient 360 (`/patients/{id}/record-shares`, patients.read; each kind needs its own permission).
 * The link is `{clinic host}/shared/{token}`; the token and PIN are never logged.
 */
class RecordSharesStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.recordshare"),
) {
    private val kinds = RecordKind.entries.filter { it.permission in clinic.permissions }
    private val mutableState =
        MutableStateFlow(
            RecordSharesState(
                allowed = PATIENTS_READ in clinic.permissions && kinds.isNotEmpty(),
                kinds = kinds,
                selected = kinds.toSet(),
            ),
        )
    val state: StateFlow<RecordSharesState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    fun toggle(kind: RecordKind) =
        mutableState.update {
            if (kind !in
                it.kinds
            ) {
                it
            } else {
                it.copy(
                    selected =
                        if (kind in
                            it.selected
                        ) {
                            it.selected - kind
                        } else {
                            it.selected + kind
                        },
                )
            }
        }

    fun setExpiry(expiry: ShareExpiry) = mutableState.update { it.copy(expiry = expiry) }

    /** Back to the form after a link was made. */
    fun reset() = mutableState.update { it.copy(phase = SharePhase.Idle) }

    /** Reloads the list of links. */
    fun refresh() {
        if (!mutableState.value.allowed) return
        scope.launch {
            when (val answer = clinic.api.recordShares(patientId)) {
                is Outcome.Success -> {
                    val rows =
                        answer.value.items.map {
                            row(
                                it.id,
                                it.recordTypes,
                                it.state,
                                it.expiresAt,
                                it.openCount,
                            )
                        }
                    mutableState.update { it.copy(links = rows, linksError = null) }
                }

                is Outcome.Failure -> {
                    log.warn("recordshare.list_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(linksError = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** Makes the link for the ticked kinds; nothing ticked, or a tap while busy, does nothing. */
    fun create() {
        val now = mutableState.value
        if (!now.allowed || now.selected.isEmpty() || now.phase == SharePhase.Creating) return
        mutableState.update { it.copy(phase = SharePhase.Creating) }
        val wire = now.kinds.filter { it in now.selected }.map { it.wire }
        scope.launch {
            when (val result = clinic.api.createRecordShare(patientId, wire, now.expiry.wire)) {
                is Outcome.Success -> {
                    log.info("recordshare.created") {
                        id("patient", patientId)
                        id("share", result.value.id)
                    }
                    val ready =
                        SharePhase.Ready(
                            "${clinic.api.origin}/shared/${result.value.token}",
                            result.value.pin,
                            day(result.value.expiresAt),
                        )
                    mutableState.update { it.copy(phase = ready) }
                    refresh()
                }

                is Outcome.Failure -> {
                    log.warn("recordshare.create_failed") { code("error", result.error.code.value) }
                    mutableState.update { it.copy(phase = SharePhase.Failed(ScreenError.of(result.error))) }
                }
            }
        }
    }

    // TODO(BK-9): a Revoke action per usable link, when the API gets `DELETE /patients/{id}/record-shares/{id}`.

    private fun row(
        id: String,
        types: List<String>,
        state: String,
        expiresAt: String,
        opens: Int,
    ) = ShareRow(
        id,
        types.mapNotNull { t -> RecordKind.entries.firstOrNull { it.wire == t } },
        when (state) {
            "usable" -> ShareLinkState.Usable
            "locked" -> ShareLinkState.Locked
            else -> ShareLinkState.Expired
        },
        day(expiresAt),
        opens,
    )

    private fun day(rfc3339: String): LocalDate? =
        runCatching { Instant.parse(rfc3339).toLocalDateTime(clinic.timeZone).date }.getOrNull()

    private companion object {
        const val PATIENTS_READ = "patients.read"
    }
}
