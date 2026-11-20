package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.desk.until
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patients.Severity
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val CHECK_URL = "$SUNRISE/api/v1/patients/p1/allergy-check"

private const val SETS =
    """{"allergies":[],"complaints":[],"findings":[],"procedures":[],"advice":[],
       "medicine_sets":[{"id":"post-extraction","label":"Post-extraction","own":false,"items":[
         {"drug_name":"Amoxicillin","strength":"500 mg","form":"capsule","dose":"1 capsule","frequency":"1-0-1","duration_days":5},
         {"drug_name":"Paracetamol","strength":"650 mg","form":"tablet","dose":"1 tablet","frequency":"SOS"}]}]}"""

private const val SERIOUS =
    """{"alerts":[{"kind":"allergy","severity":"serious","message":"Amoxicillin: recorded penicillin allergy",
       "line_no":1,"action":null,"override_reason":null}]}"""

class RxAllergyCheckTest {
    private val logs = MemoryLogSink()

    private suspend fun TestScope.sheet(backend: FakeBackend): RxSheetStateHolder {
        backend.on("$SUNRISE/api/v1/quick-picks", { json(SETS) })
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, listOf("patients.read", "clinical.read", "prescriptions.issue"))
        val holder =
            RxSheetStateHolder(
                clinic,
                "p1",
                emptyList(),
                backgroundScope,
                log = Logger("aarogyam.rxsheet", logs, LogLevel.Debug),
            )
        holder.state.first { it.sets.isNotEmpty() }
        return holder
    }

    private fun FakeBackend.checks() = requests.filter { it.url.encodedPath == "/api/v1/patients/p1/allergy-check" }

    @Test
    fun adding_a_set_checks_its_lines_once_after_the_pause_and_warns_without_blocking() =
        runTest {
            val backend = FakeBackend()
            backend.on(CHECK_URL, { json(SERIOUS) })
            val sheet = sheet(backend)
            sheet.addSet("post-extraction")
            advanceTimeBy(RxAllergyCheck.DEBOUNCE_MS - 1)
            runCurrent()
            assertTrue(backend.checks().isEmpty())
            val state = sheet.state.first { it.checkAlerts.isNotEmpty() }
            val body =
                backend
                    .checks()
                    .single()
                    .body
                    .toByteArray()
                    .decodeToString()
            assertTrue(body.contains("\"drug_name\":\"Amoxicillin\"") && body.contains("\"drug_name\":\"Paracetamol\""))
            assertEquals(
                listOf(ServerAlert(Severity.Severe, "Amoxicillin: recorded penicillin allergy")),
                state.checkAlerts,
            )
            assertTrue(state.checkSerious && state.showsCheck)
            // Only a warning: no reason is asked before Issue's own check.
            assertFalse(state.needsOverride)
            assertTrue(state.canIssue)
            assertFalse(logs.records.toString().contains("penicillin"))
        }

    @Test
    fun the_same_medicines_ask_nothing_and_no_lines_clear_the_banner() =
        runTest {
            val backend = FakeBackend()
            backend.on(CHECK_URL, { json(SERIOUS) })
            val sheet = sheet(backend)
            sheet.addSet("post-extraction")
            sheet.state.first { it.checkAlerts.isNotEmpty() }
            // A medicine already on it is skipped, so the lines are the same: no second check.
            sheet.addSet("post-extraction")
            advanceTimeBy(RxAllergyCheck.DEBOUNCE_MS * 2)
            runCurrent()
            assertEquals(1, backend.checks().size)
            sheet.state.value.lines
                .forEach { sheet.remove(it.key) }
            assertTrue(
                sheet.state.value.checkAlerts
                    .isEmpty(),
            )
            assertEquals(1, backend.checks().size)
        }

    @Test
    fun a_failed_check_keeps_the_earlier_warning_and_logs_only_the_code() =
        runTest {
            val backend = FakeBackend()
            backend.on(CHECK_URL, { json(SERIOUS) }, { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") })
            val sheet = sheet(backend)
            sheet.addSet("post-extraction")
            sheet.state.first { it.checkAlerts.isNotEmpty() }
            sheet.remove(
                sheet.state.value.lines
                    .last()
                    .key,
            )
            advanceTimeBy(RxAllergyCheck.DEBOUNCE_MS + 1)
            runCurrent()
            until { logs.records.any { it.event == "rxsheet.allergy_check_failed" } }
            assertEquals(2, backend.checks().size)
            assertEquals(1, sheet.state.value.checkAlerts.size)
        }

    @Test
    fun items_are_the_named_lines_within_the_server_limits() {
        fun line(
            key: Int,
            name: String,
        ) = RxLine(key, if (key == 0) "d0" else null, name, "", "", "", 5, null)
        val items =
            RxAllergyCheck.itemsOf(
                listOf(line(0, " Ibuprofen ")) +
                    (1..60).map {
                        line(it, if (it == 1) "  " else "x".repeat(250))
                    },
            )
        assertEquals(RxAllergyCheck.MAX_ITEMS, items.size)
        assertEquals("Ibuprofen" to "d0", items.first().drugName to items.first().drugId)
        assertEquals(RxAllergyCheck.MAX_NAME, items.last().drugName.length)
    }
}
