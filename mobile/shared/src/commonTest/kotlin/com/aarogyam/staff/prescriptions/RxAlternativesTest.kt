package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RxAlternativesTest {
    private val drug = """{"id":"d1","generic_name":"Amoxicillin","brand_name":"Mox","strength":"500 mg","form":"capsule",
       "default_dose":"1 capsule","default_frequency":"1-0-1","default_duration_days":7,"default_timing":"after_food"}"""
    private val other = """{"id":"d9","generic_name":"Amoxicillin","brand_name":"Novamox","strength":"500 mg","form":"capsule",
       "default_dose":"2 capsules","default_frequency":"1-1-1","default_duration_days":3}"""

    private suspend fun TestScope.sheet(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "clinical.read", "prescriptions.issue"),
    ): RxSheetStateHolder {
        backend.on("$SUNRISE/api/v1/drugs/search", { json("""{"items":[$drug]}""") })
        val graph = testGraph(backend, backgroundScope)
        return graph.rxSheet(openClinic(backend, graph, this, permissions), "p1", emptyList(), backgroundScope)
    }

    private suspend fun RxSheetStateHolder.addFirst(): Int {
        search("amox")
        add(state.first { it.results.isNotEmpty() }.results.first())
        return state.value.lines
            .single()
            .key
    }

    @Test
    fun swapping_keeps_the_dose_frequency_and_days() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/drugs/d1/alternatives", { json("""[$drug,$other]""") })
            val sheet = sheet(backend)
            val key = sheet.addFirst()
            sheet.setDose(key, "2 tablets")
            sheet.setDays(key, 10)
            sheet.openAlternatives(key)
            val open = sheet.state.first { it.alternatives?.loading == false }.alternatives
            assertEquals(listOf("d9"), open?.items?.map { it.id })
            sheet.swapDrug(key, open!!.items.single())
            val line =
                sheet.state.value.lines
                    .single()
            assertEquals(listOf("d9", "Novamox 500 mg capsule"), listOf(line.drugId, line.detail))
            assertEquals(listOf("2 tablets", "1-0-1", 10), listOf(line.dose, line.frequency, line.durationDays))
            assertNull(sheet.state.value.alternatives)
        }

    @Test
    fun no_alternatives_is_an_empty_list() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/drugs/d1/alternatives", { json("""[]""") })
            val sheet = sheet(backend)
            sheet.openAlternatives(sheet.addFirst())
            val open = sheet.state.first { it.alternatives?.loading == false }.alternatives
            assertEquals(emptyList(), open?.items)
            assertNull(open?.error)
        }

    @Test
    fun without_the_prescribe_permission_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val sheet = sheet(backend, listOf("patients.read", "clinical.read"))
            sheet.openAlternatives(0)
            assertEquals(0, backend.count("$SUNRISE/api/v1/drugs/d1/alternatives"))
            assertNull(sheet.state.value.alternatives)
        }
}
