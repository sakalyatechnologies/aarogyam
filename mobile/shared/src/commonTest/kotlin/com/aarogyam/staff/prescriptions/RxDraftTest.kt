package com.aarogyam.staff.prescriptions

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RxDraftTest {
    private val create = "$SUNRISE/api/v1/patients/p1/prescriptions"
    private val edit = "$SUNRISE/api/v1/prescriptions/r1"
    private val draft =
        """{"id":"r1","patient":{"id":"p1","name":"Meera Shah","number":"SD-1042"},"status":"draft","language":"en-IN",
           "created_at":"2026-10-01T05:00:00Z","alerts":[],"items":[]}"""
    private val drug =
        """{"id":"d1","generic_name":"Amoxicillin","strength":"500 mg","form":"capsule",
           "default_dose":"1 capsule","default_frequency":"1-0-1","default_duration_days":7}"""

    private fun HttpRequestData.text() = (body as TextContent).text

    private suspend fun TestScope.sheet(
        backend: FakeBackend,
        permissions: List<String> = listOf("clinical.read", "prescriptions.issue"),
    ): RxSheetStateHolder {
        backend.on("$SUNRISE/api/v1/drugs/search", { json("""{"items":[$drug]}""") })
        backend.on(create, { json(draft, HttpStatusCode.Created) })
        backend.on(edit, { json(draft) })
        val graph = testGraph(backend, backgroundScope)
        return graph.rxSheet(openClinic(backend, graph, this, permissions), "p1", emptyList(), backgroundScope, "v1")
    }

    private suspend fun RxSheetStateHolder.addOne(): Int {
        search("amox")
        add(state.first { it.results.isNotEmpty() }.results.first())
        return state.value.lines
            .single()
            .key
    }

    @Test
    fun timing_dose_and_days_land_in_the_issued_item() =
        runTest {
            val backend = FakeBackend()
            val sheet = sheet(backend)
            val key = sheet.addOne()
            sheet.setTiming(key, RxTiming.AfterFood)
            sheet.setDose(key, RxDose(2, 0, 4))
            sheet.setDays(key, 9)
            backend.on("$edit/issue", { json(draft.replace("draft", "issued")) })
            sheet.issue()
            sheet.state.first { it.phase == RxPhase.Issued }
            val body =
                backend.requests
                    .first {
                        it.method == HttpMethod.Post &&
                            it.url.encodedPath.endsWith("/prescriptions")
                    }.text()
            assertTrue(""""timing":"after_food"""" in body && """"frequency":"1-0-2"""" in body, body)
            assertTrue(""""duration_days":9""" in body && """"encounter_id":"v1"""" in body, body)
        }

    @Test
    fun a_saved_draft_is_created_once_then_edited_and_issue_reuses_it() =
        runTest {
            val backend = FakeBackend()
            val sheet = sheet(backend)
            val key = sheet.addOne()
            sheet.saveDraft()
            sheet.state.first { it.draft == DraftSave.Saved }
            sheet.setTiming(key, RxTiming.Bedtime)
            assertEquals(DraftSave.None, sheet.state.value.draft, "an edit after saving is unsaved again")
            sheet.saveDraft()
            sheet.state.first { it.draft == DraftSave.Saved }
            assertEquals(1, backend.count(create))
            val patch = backend.requests.last { it.method == HttpMethod.Patch }
            assertTrue(""""timing":"bedtime"""" in patch.text(), patch.text())
            backend.on("$edit/issue", { json(draft.replace("draft", "issued")) })
            sheet.issue()
            sheet.state.first { it.phase == RxPhase.Issued }
            assertEquals(1, backend.count(create), "issue does not start a second draft")
        }

    @Test
    fun offline_keeps_the_lines_and_reports_the_failure() =
        runTest {
            val backend = FakeBackend()
            val sheet = sheet(backend)
            backend.on(create, { throw kotlinx.io.IOException("offline") })
            sheet.addOne()
            sheet.saveDraft()
            val failed = sheet.state.first { it.draft == DraftSave.Failed }
            assertTrue(failed.error == ScreenError.Offline || failed.error == ScreenError.Network)
            assertEquals(1, failed.lines.size)
        }

    @Test
    fun without_the_permission_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            val sheet = sheet(backend, listOf("clinical.read"))
            sheet.saveDraft()
            sheet.setTiming(0, RxTiming.Sos)
            assertEquals(DraftSave.None, sheet.state.value.draft)
            assertEquals(0, backend.count(create))
        }
}
