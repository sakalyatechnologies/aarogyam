package com.aarogyam.staff.patients

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.ClinicalFlags
import com.aarogyam.staff.api.model.Patient
import com.aarogyam.staff.api.model.Visit
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.ApiErrorKind
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

/** A moment in the clinic's time zone. */
data class ClinicMoment(
    val date: LocalDate,
    val time: LocalTime,
)

/** How serious an allergy is; values the app doesn't know yet are [Unknown]. */
enum class Severity { Mild, Moderate, Severe, Unknown }

data class AllergyView(
    val substance: String,
    val severity: Severity,
    val reaction: String?,
)

/**
 * The safety banner. Everyone who can open the patient sees the counts; [detailsHidden] means the
 * role lacks `clinical.read`, so [allergies] and [conditions] are empty.
 */
data class FlagsView(
    val allergyCount: Int,
    val severeAllergy: Boolean,
    val conditionCount: Int,
    val detailsHidden: Boolean,
    val allergies: List<AllergyView>,
    val conditions: List<String>,
) {
    /** Whether the banner has anything to say. */
    val hasFlags: Boolean get() = allergyCount > 0 || conditionCount > 0
}

/** The patient's next booked or confirmed appointment. */
data class UpcomingView(
    val at: ClinicMoment,
    val practitioner: String,
)

data class VisitView(
    val id: String,
    val number: String,
    val at: ClinicMoment,
    val clinician: String,
    val reason: String?,
    val open: Boolean,
)

/** Everything Patient 360 draws. [balancePaise] is null unless the role holds `billing.read`. */
data class PatientView(
    val id: String,
    val name: String,
    val number: String,
    val ageYears: Int?,
    val sex: Sex,
    val phone: String?,
    val language: String,
    val recallDue: Boolean,
    val flags: FlagsView,
    val upcoming: List<UpcomingView>,
    /** Newest first; null when the role may not list visits. */
    val visits: List<VisitView>?,
    val balancePaise: Long?,
)

/** What the Patient 360 screen draws. */
sealed interface Patient360State {
    data object Loading : Patient360State

    /** The role lacks `patients.read`; nothing was requested. */
    data object NotAllowed : Patient360State

    data class Failed(
        val error: ScreenError,
    ) : Patient360State

    data class Loaded(
        val view: PatientView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : Patient360State
}

/**
 * One patient's overview. The API has no combined endpoint, so a load is three requests in
 * parallel (record, clinical flags, visits). A missing banner would be unsafe, so it fails the
 * screen; a role that may not list visits just doesn't see that section.
 */
class Patient360StateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.patient360"),
) {
    private val mutableState = MutableStateFlow<Patient360State>(Patient360State.Loading)

    /** The current screen state. */
    val state: StateFlow<Patient360State> = mutableState.asStateFlow()

    init {
        if (PATIENTS_READ in clinic.permissions) refresh() else mutableState.value = Patient360State.NotAllowed
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            Patient360State.NotAllowed -> {
                return
            }

            is Patient360State.Loaded -> {
                if (current.refreshing) {
                    return
                } else {
                    mutableState.value =
                        current.copy(refreshing = true, error = null)
                }
            }

            else -> {
                mutableState.value = Patient360State.Loading
            }
        }
        scope.launch {
            val result = load()
            mutableState.value =
                when (result) {
                    is Outcome.Success -> {
                        Patient360State.Loaded(result.value)
                    }

                    is Outcome.Failure -> {
                        log.warn("patient360.load_failed") {
                            id("patient", patientId)
                            code("error", result.error.code.value)
                        }
                        val error = ScreenError.of(result.error)
                        if (current is Patient360State.Loaded) {
                            current.copy(
                                refreshing = false,
                                error = error,
                            )
                        } else {
                            Patient360State.Failed(error)
                        }
                    }
                }
        }
    }

    private suspend fun load(): Outcome<PatientView, ApiError> =
        coroutineScope {
            val patient = async { clinic.api.patient(patientId) }
            val flags = async { clinic.api.clinicalFlags(patientId) }
            val visits = async { clinic.api.visits(patientId) }
            val p = patient.await()
            val f = flags.await()
            val v = visits.await()
            when {
                p is Outcome.Failure -> {
                    p
                }

                f is Outcome.Failure -> {
                    f
                }

                p is Outcome.Success && f is Outcome.Success -> {
                    val list =
                        when (v) {
                            is Outcome.Success -> {
                                v.value.items
                            }

                            is Outcome.Failure -> {
                                if (v.error.kind ==
                                    ApiErrorKind.Forbidden
                                ) {
                                    null
                                } else {
                                    return@coroutineScope v
                                }
                            }
                        }
                    Outcome.Success(toView(p.value, f.value, list))
                }

                else -> {
                    error("unreachable")
                }
            }
        }

    private fun toView(
        patient: Patient,
        flags: ClinicalFlags,
        visits: List<Visit>?,
    ): PatientView {
        val zone = clinic.timeZone
        return PatientView(
            id = patient.id,
            name = patient.fullName,
            number = patient.number,
            ageYears = patient.ageYears,
            sex = sexOf(patient.sex),
            phone = patient.phone,
            language = patient.preferredLanguage,
            recallDue = patient.recallDue,
            flags = flags.toView(),
            upcoming =
                listOfNotNull(
                    patient.nextAppointment?.let { next ->
                        moment(next.startsAt, zone)?.let { UpcomingView(it, next.practitioner) }
                    },
                ),
            visits = visits?.mapNotNull { it.toView(zone) }?.take(RECENT_VISITS),
            balancePaise = if (BILLING_READ in clinic.permissions) patient.balancePaise else null,
        )
    }

    private companion object {
        const val PATIENTS_READ = "patients.read"
        const val BILLING_READ = "billing.read"
        const val RECENT_VISITS = 5
    }
}

private fun moment(
    text: String,
    zone: TimeZone,
): ClinicMoment? = parseInstant(text)?.toLocalDateTime(zone)?.let { ClinicMoment(it.date, it.time) }

private fun Visit.toView(zone: TimeZone): VisitView? =
    moment(startedAt, zone)?.let {
        VisitView(id, number, it, clinician.name, chiefComplaint, open = status == "open")
    }

private fun ClinicalFlags.toView() =
    FlagsView(
        allergyCount = allergyCount,
        severeAllergy = severeAllergy,
        conditionCount = conditionCount,
        detailsHidden = detailsHidden,
        allergies = allergies.map { AllergyView(it.substance, severityOf(it.severity), it.reaction) },
        conditions = conditions.map { it.displayText },
    )

private fun severityOf(text: String): Severity =
    when (text) {
        "mild" -> Severity.Mild
        "moderate" -> Severity.Moderate
        "severe" -> Severity.Severe
        else -> Severity.Unknown
    }
