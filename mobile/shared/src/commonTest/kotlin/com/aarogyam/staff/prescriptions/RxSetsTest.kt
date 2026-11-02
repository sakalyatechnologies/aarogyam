package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.Severity
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private const val PICKS_URL = "$SUNRISE/api/v1/quick-picks"

private const val SETS_JSON =
    """{"allergies":[],"complaints":[],"findings":[],"procedures":[],"advice":[],
       "medicine_sets":[{"id":"post-extraction","label":"Post-extraction","own":false,"items":[
         {"drug_name":"Amoxicillin","strength":"500 mg","form":"capsule","dose":"1 capsule","frequency":"1-0-1","duration_days":5,"instructions":"Finish the course","timing":"after_food"},
         {"drug_name":"Paracetamol","strength":"650 mg","form":"tablet","dose":"1 tablet","frequency":"SOS"}]}]}"""

class RxSetsTest {
    private suspend fun TestScope.holder(
        allergies: List<AllergyView> = emptyList(),
        permissions: List<String> = listOf("patients.read", "clinical.read", "prescriptions.issue"),
    ): RxSheetStateHolder {
        val backend = FakeBackend()
        backend.on(PICKS_URL, { json(SETS_JSON) })
        val graph = testGraph(backend, backgroundScope)
        return graph.rxSheet(openClinic(backend, graph, this, permissions), "p1", allergies, backgroundScope)
    }

    @Test
    fun sets_load_into_state() =
        runTest {
            val sheet = holder()
            val chip =
                sheet.state
                    .first { it.sets.isNotEmpty() }
                    .sets
                    .single()
            assertEquals(RxSetChip("post-extraction", "Post-extraction", 2), chip)
        }

    @Test
    fun add_set_appends_mapped_lines_with_fresh_keys() =
        runTest {
            val sheet = holder()
            sheet.state.first { it.sets.isNotEmpty() }
            sheet.addSet("post-extraction")
            val lines = sheet.state.value.lines
            assertEquals(listOf("Amoxicillin", "Paracetamol"), lines.map { it.name })
            assertEquals(2, lines.map { it.key }.toSet().size)
            val first = lines.first()
            assertEquals(null, first.drugId)
            assertEquals("500 mg capsule", first.detail)
            assertEquals(
                listOf("1 capsule", "1-0-1", 5, "after_food"),
                listOf(first.dose, first.frequency, first.durationDays, first.timing),
            )
            assertEquals(5, lines.last().durationDays)
            sheet.addSet("unknown")
            assertEquals(2, sheet.state.value.lines.size)
        }

    @Test
    fun a_medicine_already_on_the_prescription_is_skipped() =
        runTest {
            val sheet = holder()
            sheet.state.first { it.sets.isNotEmpty() }
            sheet.addSet("post-extraction")
            sheet.addSet("post-extraction")
            assertEquals(2, sheet.state.value.lines.size)
            assertEquals(
                2,
                sheet.state.value.lines
                    .map { it.key }
                    .toSet()
                    .size,
            )
        }

    @Test
    fun without_permission_there_are_no_sets() =
        runTest {
            val sheet = holder(permissions = listOf("patients.read"))
            sheet.addSet("post-extraction")
            assertTrue(
                sheet.state.value.sets
                    .isEmpty(),
            )
            assertTrue(
                sheet.state.value.lines
                    .isEmpty(),
            )
        }

    @Test
    fun an_allergy_match_on_a_set_line_warns() =
        runTest {
            val sheet = holder(listOf(AllergyView("Amoxicillin", Severity.Severe, "Rash")))
            sheet.state.first { it.sets.isNotEmpty() }
            sheet.addSet("post-extraction")
            assertEquals(
                "Amoxicillin",
                sheet.state.value.warnings
                    .single()
                    .substance,
            )
        }
}
