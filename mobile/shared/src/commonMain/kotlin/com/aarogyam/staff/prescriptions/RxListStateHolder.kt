package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Prescription
import com.aarogyam.staff.api.model.RxItem
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

/** Permission that lets a role list a patient's prescriptions. */
const val CLINICAL_READ = "clinical.read"

/** Permission that lets a role search the catalogue, draft, issue and share prescriptions. */
const val PRESCRIPTIONS_ISSUE = "prescriptions.issue"

enum class RxStatus { Draft, Issued, Cancelled, Unknown }

/** One medicine line as the list shows it. */
data class RxMedicine(
    val name: String,
    val dose: String?,
    val frequency: String?,
    val durationDays: Int?,
)

data class RxSummary(
    val id: String,
    /** `RX-412`, once issued. */
    val number: String?,
    val status: RxStatus,
    /** When it was issued, or started when still a draft. */
    val at: ClinicMoment?,
    val diagnosis: String?,
    val medicines: List<RxMedicine>,
    /** Issued despite an allergy alert. */
    val allergyOverridden: Boolean,
)

/** What the Rx tab draws. */
sealed interface RxListState {
    data object Loading : RxListState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : RxListState

    data class Failed(
        val error: ScreenError,
    ) : RxListState

    /** Newest first. [canIssue] tells whether the role may start a prescription. */
    data class Loaded(
        val items: List<RxSummary>,
        val canIssue: Boolean,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : RxListState
}

/** The patient's prescriptions, newest first: one request. */
class RxListStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.rxlist"),
) {
    private val mutableState = MutableStateFlow<RxListState>(RxListState.Loading)

    /** The current tab state. */
    val state: StateFlow<RxListState> = mutableState.asStateFlow()

    init {
        if (CLINICAL_READ in clinic.permissions) refresh() else mutableState.value = RxListState.NotAllowed
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            RxListState.NotAllowed -> {
                return
            }

            is RxListState.Loaded -> {
                if (current.refreshing) return
                mutableState.value = current.copy(refreshing = true, error = null)
            }

            else -> {
                mutableState.value = RxListState.Loading
            }
        }
        scope.launch {
            mutableState.value =
                when (val result = clinic.api.prescriptions(patientId)) {
                    is Outcome.Success -> {
                        RxListState.Loaded(
                            items = result.value.items.map { it.toSummary(clinic.timeZone) },
                            canIssue = PRESCRIPTIONS_ISSUE in clinic.permissions,
                        )
                    }

                    is Outcome.Failure -> {
                        log.warn("rxlist.load_failed") {
                            id("patient", patientId)
                            code("error", result.error.code.value)
                        }
                        val error = ScreenError.of(result.error)
                        if (current is RxListState.Loaded) {
                            current.copy(refreshing = false, error = error)
                        } else {
                            RxListState.Failed(error)
                        }
                    }
                }
        }
    }
}

internal fun Prescription.toSummary(zone: TimeZone): RxSummary =
    RxSummary(
        id = id,
        number = number,
        status = statusOf(status),
        at =
            (issuedAt ?: createdAt)
                .let { text ->
                    parseInstant(text)?.toLocalDateTime(zone)
                }?.let { ClinicMoment(it.date, it.time) },
        diagnosis = diagnosisText?.takeIf { it.isNotBlank() },
        medicines = items.map { it.toMedicine() },
        allergyOverridden = overrideReason != null,
    )

private fun RxItem.toMedicine() =
    RxMedicine(
        name = listOfNotNull(drugName, strength).joinToString(" "),
        dose = dose,
        frequency = frequency,
        durationDays = durationDays,
    )

private fun statusOf(text: String): RxStatus =
    when (text) {
        "draft" -> RxStatus.Draft
        "issued" -> RxStatus.Issued
        "cancelled" -> RxStatus.Cancelled
        else -> RxStatus.Unknown
    }
