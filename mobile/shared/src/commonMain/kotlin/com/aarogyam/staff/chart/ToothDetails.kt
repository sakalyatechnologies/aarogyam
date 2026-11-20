package com.aarogyam.staff.chart

import com.aarogyam.staff.api.model.ChartEntry
import com.aarogyam.staff.api.model.ToothCondition
import com.aarogyam.staff.api.model.ToothEruption
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone

// The exact-detail chips (visit story v2, section 1.13). The values equal
// specialties/dental/chart-details.json; they are mapped as strings, so a value added later is
// ignored instead of breaking the chart.

/** How deep a decay reaches, on a caries entry. */
enum class CariesDepth(
    internal val wire: String,
) {
    Enamel("enamel"),
    Dentin("dentin"),
    NearPulp("near_pulp"),
    ;

    internal companion object {
        fun of(wire: String?): CariesDepth? = entries.firstOrNull { it.wire == wire }
    }
}

/** An infection at the root of a tooth. */
enum class RootInfection(
    internal val wire: String,
) {
    Infection("infection"),
    Abscess("abscess"),
    ;

    internal companion object {
        fun of(wire: String?): RootInfection? = entries.firstOrNull { it.wire == wire }
    }
}

/** How far a permanent tooth is through the gum. */
enum class Eruption(
    internal val wire: String,
) {
    Erupted("erupted"),
    Partial("partial"),
    Impacted("impacted"),
    Unerupted("unerupted"),
    ;

    /** Only a tooth not fully through has an angle. */
    val takesAngle: Boolean get() = this != Erupted

    internal companion object {
        fun of(wire: String?): Eruption? = entries.firstOrNull { it.wire == wire }
    }
}

/** The angle of a tooth that is not fully through. */
enum class Angulation(
    internal val wire: String,
) {
    Vertical("vertical"),
    Mesioangular("mesioangular"),
    Distoangular("distoangular"),
    Horizontal("horizontal"),
    ;

    internal companion object {
        fun of(wire: String?): Angulation? = entries.firstOrNull { it.wire == wire }
    }
}

/** The pocket chips in mm; the last reads "7+" and is stored as 7. */
val POCKET_CHIPS_MM: List<Int> = listOf(4, 5, 6, 7)

/** The mobility grades offered as chips (0, "not loose", is the default and needs no tap). */
val MOBILITY_GRADES: List<Int> = listOf(1, 2, 3)

/** The wisdom teeth, where the eruption row shows. */
val WISDOM_TEETH: Set<Int> = setOf(18, 28, 38, 48)

/** The finished work after which "Infection resolved" is offered. */
private val WORK_FINDINGS =
    setOf(Finding.Filled, Finding.Crown, Finding.RootCanal, Finding.Implant, Finding.Bridge, Finding.Missing)

/** A tooth's current condition; each field only when recorded. [at] is when it was last recorded. */
data class ToothConditionView(
    val infection: RootInfection? = null,
    val bleeding: Boolean? = null,
    val pocketMm: Int? = null,
    val mobility: Int? = null,
    val at: ClinicMoment? = null,
) {
    /** Anything is recorded: the server keeps no empty condition. */
    val recorded: Boolean get() = infection != null || bleeding != null || pocketMm != null || mobility != null

    /** Something besides the infection is recorded, so clearing the infection leaves a row. */
    internal val beyondInfection: Boolean get() = copy(infection = null).recorded
}

/** A permanent tooth's current eruption. */
data class ToothEruptionView(
    val eruption: Eruption,
    val angulation: Angulation? = null,
    val at: ClinicMoment? = null,
)

/** A current caries entry: its surface (null for the whole tooth), depth and what goes with it. */
internal data class CariesMark(
    val surface: Surface?,
    val depth: CariesDepth?,
    val note: String?,
    val procedure: String?,
    val material: String?,
)

/** What the tooth sheet's detail chips show for the picked tooth. */
data class ToothDetailsView(
    val condition: ToothConditionView? = null,
    val eruption: ToothEruptionView? = null,
    /** The tooth has a current caries entry: the depth chips show. */
    val hasCaries: Boolean = false,
    /** The deepest recorded depth among its caries entries. */
    val cariesDepth: CariesDepth? = null,
    /** The condition row is hidden on a missing tooth, as on the web. */
    val missing: Boolean = false,
    /** The eruption row shows on a wisdom tooth. */
    val wisdom: Boolean = false,
    /** An infection is recorded and finished work was charted on the tooth today. */
    val canResolveInfection: Boolean = false,
)

internal fun conditionsOf(
    rows: List<ToothCondition>?,
    zone: TimeZone,
): Map<Int, ToothConditionView> =
    rows.orEmpty().associate { c ->
        c.tooth to
            ToothConditionView(
                infection = RootInfection.of(c.infection),
                bleeding = c.bleeding,
                pocketMm = c.pocketMm,
                mobility = c.mobility,
                at = moment(c.recordedAt, zone),
            )
    }

internal fun eruptionsOf(
    rows: List<ToothEruption>?,
    zone: TimeZone,
): Map<Int, ToothEruptionView> =
    rows
        .orEmpty()
        .mapNotNull { e ->
            Eruption.of(e.eruption)?.let {
                e.tooth to
                    ToothEruptionView(it, Angulation.of(e.angulation), moment(e.recordedAt, zone))
            }
        }.toMap()

internal fun cariesOf(current: List<ChartEntry>): Map<Int, List<CariesMark>> =
    current
        .filter { it.status == "current" && it.finding == Finding.Caries.wire }
        .groupBy({ it.tooth }) {
            CariesMark(
                Surface.of(it.surface),
                CariesDepth.of(it.cariesDepth),
                it.note,
                it.procedure?.id,
                it.material?.id,
            )
        }

/** The picked tooth's detail chips. */
internal fun detailsOf(
    tooth: ToothView,
    condition: ToothConditionView?,
    eruption: ToothEruptionView?,
    caries: List<CariesMark>,
    history: HistoryState,
    today: LocalDate,
): ToothDetailsView {
    val workToday =
        (history as? HistoryState.Loaded)?.entries.orEmpty().any {
            it.status == EntryStatus.Current && it.finding in WORK_FINDINGS && it.at?.date == today && !it.elsewhere
        }
    val missing = tooth.whole == Finding.Missing
    return ToothDetailsView(
        condition = condition,
        eruption = eruption,
        hasCaries = caries.isNotEmpty(),
        cariesDepth = caries.mapNotNull { it.depth }.maxByOrNull { it.ordinal },
        missing = missing,
        wisdom = tooth.number in WISDOM_TEETH,
        // The server keeps no empty condition, so an infection alone can't be cleared this way yet.
        canResolveInfection = !missing && condition?.infection != null && condition.beyondInfection && workToday,
    )
}
