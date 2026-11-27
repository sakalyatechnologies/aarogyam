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
    }

    @Test
    fun in_progress_posts_the_treatment_entry_as_started_and_needs_a_chart_mark() {
        assertEquals(
            TreatmentCheck.Ok(TreatmentPlan(Finding.Crown, null, inProgress = true)),
            planTreatment(TreatmentStatus.InProgress, seeded("crown"), inVisit = true),
        )
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.NoChartMark),
            planTreatment(TreatmentStatus.InProgress, seeded("scaling"), inVisit = true),
        )
        assertEquals(
            TreatmentCheck.Blocked(TreatmentBlock.NoTreatment),
            planTreatment(TreatmentStatus.InProgress, null, inVisit = false),
        )
    }

    @Test
    fun the_record_plan_sends_in_progress_only_with_a_finding_and_supersedes_on_the_first_entry() {
        val crown = seeded("crown")
        val started =
            recordPlan(emptyMap(), listOf(16), Finding.Crown, emptyList(), crown, null, null, "old", inProgress = true)
        assertEquals(true, started.second.single().inProgress)
        assertEquals("old", started.second.single().supersedesId)
        val done = recordPlan(emptyMap(), listOf(16), Finding.Crown, emptyList(), crown, null, null, "old")
        assertNull(done.second.single().inProgress, "done leaves the flag out: it defaults to false")
        val sound = recordPlan(emptyMap(), listOf(16), Finding.Sound, emptyList(), null, null, null, inProgress = true)
        assertNull(sound.second.single().inProgress)
    }
}
