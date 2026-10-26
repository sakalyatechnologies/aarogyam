package com.aarogyam.staff.chart

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TreatmentFormTest {
    private fun seeded(id: String) = TermView(id, TermKind.Procedure, id, own = false)

    @Test
    fun seeded_procedures_leave_their_mark_on_the_tooth() {
        assertEquals(Finding.Filled, ProcedureFindings.of(seeded("filling")))
        assertEquals(Finding.Filled, ProcedureFindings.of(seeded("sealant")))
        assertEquals(Finding.Crown, ProcedureFindings.of(seeded("veneer")))
        assertEquals(Finding.RootCanal, ProcedureFindings.of(seeded("post_core")))
        assertEquals(Finding.Implant, ProcedureFindings.of(seeded("implant")))
        assertEquals(Finding.Missing, ProcedureFindings.of(seeded("extraction")))
        assertEquals(Finding.Bridge, ProcedureFindings.of(seeded("bridge_pontic")))
        assertNull(ProcedureFindings.of(seeded("scaling")))
        assertNull(ProcedureFindings.of(seeded("pulpotomy")))
        assertEquals(Finding.Filled, ProcedureFindings.of(TermView("u-1", TermKind.Procedure, "Laser gum", own = true)))
    }

    @Test
    fun completed_draws_the_finding_and_logs_inside_a_visit() {
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(Finding.Crown, "done")),
            planTreatment(TreatmentStatus.Completed, seeded("crown"), inVisit = true),
        )
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(Finding.Crown, null)),
            planTreatment(TreatmentStatus.Completed, seeded("crown"), inVisit = false),
        )
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(null, "done")),
            planTreatment(TreatmentStatus.Completed, seeded("scaling"), inVisit = true),
        )
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.NoChartMark),
            planTreatment(TreatmentStatus.Completed, seeded("scaling"), inVisit = false),
        )
    }

    @Test
    fun planned_needs_a_visit_and_watch_needs_nothing() {
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.NeedsVisit),
            planTreatment(TreatmentStatus.Planned, seeded("crown"), false),
        )
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(null, "planned")),
            planTreatment(TreatmentStatus.Planned, seeded("crown"), true),
        )
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.NoTreatment),
            planTreatment(TreatmentStatus.Completed, null, true),
        )
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(Finding.Watch, null)),
            planTreatment(TreatmentStatus.Watch, null, false),
        )
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.SurfaceChangePreview),
            planTreatment(TreatmentStatus.Watch, null, false, surfaceChanged = true),
        )
    }
}
