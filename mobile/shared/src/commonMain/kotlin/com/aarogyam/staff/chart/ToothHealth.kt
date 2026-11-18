package com.aarogyam.staff.chart

import com.aarogyam.staff.api.model.ToothStatus
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import kotlinx.datetime.TimeZone

/** A tooth's health as a doctor sets it, as the API names it. */
enum class HealthLevel(
    internal val wire: String,
) {
    Healthy("healthy"),
    Watch("watch"),
    NeedsTreatment("needs_treatment"),
    ;

    /** Whether a "treat within" time goes with it. */
    val advisesTreatment: Boolean get() = this != Healthy

    internal companion object {
        fun of(wire: String): HealthLevel? = entries.firstOrNull { it.wire == wire }
    }
}

/** The doctor's status on one tooth. [treatWithinMonths] is 1, 3, 6 or 12, only with watch or needs treatment. */
data class ToothStatusView(
    val level: HealthLevel,
    val note: String? = null,
    val treatWithinMonths: Int? = null,
    val at: ClinicMoment? = null,
)

/** The months a doctor may advise treating within. */
val TREAT_WITHIN_MONTHS: List<Int> = listOf(1, 3, 6, 12)

/** The findings that "done elsewhere" may go with: finished work only, as the API allows. */
internal val ELSEWHERE_FINDINGS: Set<Finding> =
    setOf(Finding.Filled, Finding.Crown, Finding.Implant, Finding.RootCanal, Finding.Bridge, Finding.Missing)

/**
 * The health the tooth's findings suggest when the doctor has set none: caries or a fracture need
 * treatment, a watch finding is watch, anything else is healthy. A missing tooth, or one with
 * nothing recorded, suggests nothing.
 */
val ToothView.suggestedHealth: HealthLevel?
    get() {
        val found = findings.map { it.finding }
        return when {
            found.isEmpty() || Finding.Missing in found -> null
            found.any { it == Finding.Caries || it == Finding.Fractured } -> HealthLevel.NeedsTreatment
            Finding.Watch in found -> HealthLevel.Watch
            else -> HealthLevel.Healthy
        }
    }

/** The statuses by tooth; unknown levels are left out. */
internal fun statusesOf(
    statuses: List<ToothStatus>?,
    zone: TimeZone,
): Map<Int, ToothStatusView> =
    statuses
        .orEmpty()
        .mapNotNull { s ->
            HealthLevel.of(s.health.value)?.let { level ->
                s.tooth to ToothStatusView(level, s.note, s.treatWithinMonths, moment(s.recordedAt, zone))
            }
        }.toMap()
