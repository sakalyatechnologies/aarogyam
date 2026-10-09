package com.aarogyam.staff.chart

/** The Add treatment form's status switch. */
enum class TreatmentStatus {
    /** Done today: drawn on the chart, and logged as a visit procedure inside a visit. */
    Completed,

    /** To do later: a planned visit procedure; only inside a visit. */
    Planned,

    /** Keep an eye on it: a "watch" finding on the chart. */
    Watch,
}

/** Why Save is not possible yet; the form shows the reason beside the button. */
enum class TreatmentBlock {
    /** Pick a treatment first (Completed and Planned). */
    NoTreatment,

    /** Planned needs an open visit to hang the plan on. */
    NeedsVisit,

    /** This treatment leaves no mark on the chart (scaling, pulpotomy), so it needs a visit. */
    NoChartMark,

    /** Changing the surface of an earlier entry needs server support (BK-1). */
    SurfaceChangePreview,
}

/**
 * Which chart finding a seeded procedure leaves on the tooth. Procedures with no lasting mark
 * (scaling, pulpotomy) return null and are recorded only as visit procedures.
 */
object ProcedureFindings {
    private val map: Map<String, Finding> =
        mapOf(
            "filling" to Finding.Filled,
            "inlay" to Finding.Filled,
            "onlay" to Finding.Filled,
            "sealant" to Finding.Filled,
            "crown" to Finding.Crown,
            "veneer" to Finding.Crown,
            "core_build_up" to Finding.Crown,
            "root_canal" to Finding.RootCanal,
            "post_core" to Finding.RootCanal,
            "implant" to Finding.Implant,
            "extraction" to Finding.Missing,
            "bridge_abutment" to Finding.Bridge,
            "bridge_pontic" to Finding.Bridge,
        )

    /** The finding for [term], or null when it leaves none; a clinic's own term defaults to filled. */
    fun of(term: TermView): Finding? = if (term.own) Finding.Filled else map[term.id]
}

/** What saving the form does: the chart finding (if any) and whether a visit procedure is logged. */
data class TreatmentPlan(
    val finding: Finding?,
    val procedureStatus: String?,
)

/**
 * Decides what Save does for [status] with [treatment] picked, inside a visit or not. Returns the
 * plan, or the reason it cannot be saved.
 */
fun planTreatment(
    status: TreatmentStatus,
    treatment: TermView?,
    inVisit: Boolean,
    surfaceChanged: Boolean = false,
): TreatmentCheck {
    if (surfaceChanged) return TreatmentCheck.Blocked(TreatmentBlock.SurfaceChangePreview)
    return when (status) {
        TreatmentStatus.Watch -> {
            TreatmentCheck.Ok(TreatmentPlan(Finding.Watch, null))
        }

        TreatmentStatus.Planned -> {
            when {
                treatment == null -> TreatmentCheck.Blocked(TreatmentBlock.NoTreatment)
                !inVisit -> TreatmentCheck.Blocked(TreatmentBlock.NeedsVisit)
                else -> TreatmentCheck.Ok(TreatmentPlan(null, "planned"))
            }
        }

        TreatmentStatus.Completed -> {
            if (treatment == null) return TreatmentCheck.Blocked(TreatmentBlock.NoTreatment)
            val finding = ProcedureFindings.of(treatment)
            when {
                finding == null && !inVisit -> TreatmentCheck.Blocked(TreatmentBlock.NoChartMark)
                else -> TreatmentCheck.Ok(TreatmentPlan(finding, if (inVisit) "done" else null))
            }
        }
    }
}

/** A plan, or the reason there is none. */
sealed interface TreatmentCheck {
    data class Ok(
        val plan: TreatmentPlan,
    ) : TreatmentCheck

    data class Blocked(
        val reason: TreatmentBlock,
    ) : TreatmentCheck
}
