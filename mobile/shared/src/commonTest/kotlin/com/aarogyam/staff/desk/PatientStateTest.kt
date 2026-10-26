package com.aarogyam.staff.desk

import kotlin.test.Test
import kotlin.test.assertEquals

class PatientStateTest {
    private data class Row(
        val token: String?,
        val calledAt: String?,
        val visit: Boolean,
        val appt: String?,
        val want: PatientState?,
    )

    private val table =
        listOf(
            Row("waiting", null, false, null, PatientState.Waiting),
            Row("waiting", "2026-10-10T04:00:00Z", false, "arrived", PatientState.Called),
            Row("waiting", "", false, null, PatientState.Waiting),
            Row("called", null, false, null, PatientState.Called),
            Row("in_chair", null, false, "in_chair", PatientState.InChair),
            Row("in_chair", null, true, null, PatientState.InConsult),
            Row("ready_to_bill", null, true, null, PatientState.ReadyToBill),
            Row("done", null, false, "completed", PatientState.Done),
            Row("left", "2026-10-10T04:00:00Z", false, null, PatientState.Left),
            Row(null, null, false, "arrived", PatientState.Waiting),
            Row(null, null, false, "in_chair", PatientState.InChair),
            Row(null, null, true, "in_chair", PatientState.InConsult),
            Row(null, null, false, "completed", PatientState.Done),
            Row(null, null, false, "no_show", PatientState.Left),
            Row(null, null, false, "cancelled", PatientState.Left),
            Row(null, null, false, "booked", null),
            Row(null, null, false, "confirmed", null),
            Row("surprise", null, false, null, null),
        )

    @Test
    fun the_mapper_table() {
        table.forEach {
            assertEquals(it.want, patientState(it.token, it.calledAt, it.visit, it.appt), "$it")
        }
    }
}
