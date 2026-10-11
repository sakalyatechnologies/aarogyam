package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.device.FakeDictation
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class VisitCloseWithTest {
    private val visit = """{"id":"v1","number":"V-318","patient_id":"p1","status":"open","started_at":"2026-10-09T04:30:00Z",
        "clinician":{"id":"m1","name":"Dr. Patil"}}"""
    private val recall = """{"id":"c1","patient":{"id":"p1","name":"Meera Shah","number":"SD-1"},"kind":"follow_up",
        "reason":"follow_up","due_on":"2026-10-20","status":"due"}"""
    private val recalls = "$SUNRISE/api/v1/patients/p1/recalls"
    private val close = "$SUNRISE/api/v1/visits/v1/close"

    private suspend fun TestScope.open(
        backend: FakeBackend,
        permissions: List<String> = listOf("clinical.write"),
    ): VisitStateHolder {
        backend.on("$SUNRISE/api/v1/patients/p1/visits", { json(visit, HttpStatusCode.Created) })
        backend.on(close, { json(visit.replace("\"open\"", "\"closed\"")) })
        backend.on(recalls, { json(recall, HttpStatusCode.Created) })
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions)
        return VisitStateHolder(clinic, "p1", null, null, FakeDictation(), backgroundScope)
    }

    private fun VisitStateHolder.view() = (state.value as VisitState.Open).view

    private fun FakeBackend.closeBody() =
        (requests.last { it.url.encodedPath.endsWith("/close") }.body as TextContent).text

    @Test
    fun closing_without_a_follow_up_or_fee_sends_no_body_and_makes_no_recall() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            holder.state.first { it is VisitState.Open }
            holder.close()
            holder.state.first { (it as? VisitState.Open)?.view?.let { v -> v.closed && !v.closing } == true }
            assertEquals(1, backend.count(close))
            assertEquals(0, backend.count(recalls))
            assertTrue(backend.requests.last { it.url.encodedPath.endsWith("/close") }.body !is TextContent)
        }

    @Test
    fun the_close_carries_the_follow_up_reason_and_fee_and_the_client_makes_no_recall() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            holder.state.first { it is VisitState.Open }
            holder.closeWith("2026-10-20", "Review the filling", 150000)
            holder.state.first { (it as? VisitState.Open)?.view?.let { v -> v.closed && !v.closing } == true }
            val body = backend.closeBody()
            assertTrue(""""follow_up_on":"2026-10-20"""" in body, body)
            assertTrue(""""follow_up_reason":"Review the filling"""" in body, body)
            assertTrue(""""fee_paise":150000""" in body, body)
            assertEquals(1, backend.count(close))
            assertEquals(0, backend.count(recalls))
        }

    @Test
    fun a_refused_close_keeps_the_visit_open_and_shows_the_error() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            backend.on(close, { apiError(HttpStatusCode.BadRequest, "invalid_input") })
            holder.state.first { it is VisitState.Open }
            holder.closeWith("2020-01-01", null, null)
            val view = (holder.state.first { (it as? VisitState.Open)?.view?.error != null } as VisitState.Open).view
            assertTrue(!view.closed && !view.closing)
            assertEquals(0, backend.count(recalls))
        }

    @Test
    fun offline_at_close_leaves_the_visit_open() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            backend.on(close, { throw kotlinx.io.IOException("offline") })
            holder.state.first { it is VisitState.Open }
            holder.closeWith("2026-10-20", null, null)
            val view = (holder.state.first { (it as? VisitState.Open)?.view?.error != null } as VisitState.Open).view
            assertTrue(view.error == ScreenError.Offline || view.error == ScreenError.Network)
            assertTrue(!view.closed)
            assertEquals(0, backend.count(recalls))
        }

    @Test
    fun without_clinical_write_closeWith_does_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend, listOf("clinical.read"))
            holder.closeWith("2026-10-20", null, null)
            assertEquals(VisitState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(close))
        }
}
