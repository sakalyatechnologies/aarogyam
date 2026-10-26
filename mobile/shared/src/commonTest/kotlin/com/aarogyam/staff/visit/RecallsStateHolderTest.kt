package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

class RecallsStateHolderTest {
    private fun recall(
        id: String,
        patient: String,
    ) =
        """{"id":"$id","patient":{"id":"$patient","name":"N","number":"SD-1"},"kind":"follow_up","reason":"r","due_on":"2026-10-20","status":"due"}"""

    @Test
    fun lists_only_this_patients_recalls_and_without_permission_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/recalls",
                { json("""{"items":[${recall("c1", "p1")},${recall("c2", "p2")}]}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            val holder = RecallsStateHolder(clinic, "p1", backgroundScope)
            holder.load()
            assertEquals(
                listOf("c1"),
                holder.state
                    .first { it.items.isNotEmpty() }
                    .items
                    .map { it.id },
            )
            val denied =
                RecallsStateHolder(openClinic(backend, graph, this, listOf("clinical.read")), "p1", backgroundScope)
            denied.load()
            assertEquals(1, backend.count("$SUNRISE/api/v1/recalls"))
        }
}
