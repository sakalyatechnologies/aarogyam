package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.outbox.ManualConnectivity
import com.aarogyam.staff.outbox.MemoryOutboxFiles
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.WriteQueue
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private typealias Answer = MockRequestHandleScope.(HttpRequestData) -> HttpResponseData

class FinishVisitHolderTest {
    private val visit = """{"id":"v1","number":"V-318","patient_id":"p1","status":"open","started_at":"2026-10-09T04:30:00Z",
        "clinician":{"id":"m1","name":"Dr. Patil"}}"""
    private val finished = """{"signed_note_ids":["n1"],"unsigned_note_ids":[],"visit":${visit.replace(
        "\"open\"",
        "\"closed\"",
    )}"""
    private val finishRoute = "$SUNRISE/api/v1/visits/v1/finish"
    private val visitRoute = "$SUNRISE/api/v1/visits/v1"
    private val order = mutableListOf<String>()

    private fun procedure(
        id: String,
        status: String,
        price: Long?,
    ) =
        """{"id":"$id","name":"Filling","status":"$status","surfaces":[],"visit_id":"v1","created_at":"2026-10-12T04:30:00Z",
        "clinician":{"id":"m1","name":"Dr. Patil"}${price?.let { ""","price_paise":$it""" } ?: ""}}"""

    private fun detail(vararg procedures: String) =
        """{"attachments":[],"chart_entries":[],"notes":[],"observations":[],"procedures":[${procedures.joinToString(
            ",",
        )}],"visit":$visit}"""

    private val invoice =
        """{"id":"i1","status":"draft","balance_paise":120000,"cgst_paise":0,"sgst_paise":0,"igst_paise":0,"created_at":"2026-10-12T05:00:00Z",
        "discount_paise":0,"items":[],"methods":[],"paid_paise":0,"round_off_paise":0,"subtotal_paise":120000,"tax_paise":0,
        "taxable_paise":120000,"total_paise":120000,"patient":{"id":"p1","name":"Meera Shah","number":"SD-1"}}"""

    private fun FakeBackend.finishBody() = requests.last { it.url.encodedPath.endsWith("/finish") }

    private suspend fun HttpRequestData.text() = body.toByteArray().decodeToString()

    private suspend fun TestScope.open(
        backend: FakeBackend,
        vararg finishAnswers: Answer,
    ): FinishVisitStateHolder {
        backend.on(visitRoute, { json(detail()) })
        val ok: Answer = {
            order += "finish"
            json("$finished}")
        }
        backend.on(finishRoute, *(if (finishAnswers.isEmpty()) arrayOf(ok) else finishAnswers))
        val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
        return FinishVisitStateHolder(clinic, "v1", backgroundScope, today = { LocalDate(2026, 10, 12) })
    }

    private fun sources(
        draft: String? = "rx1",
        writes: WriteQueue? = null,
    ) = FinishSources(
        patientId = "p1",
        saveNote = {
            order += "note"
            true
        },
        saveRx = {
            order += "rx"
            RxSave.Saved(draft)
        },
        rxDraftId = { draft },
        writes = writes,
    )

    private fun writeQueue(online: Boolean): Pair<WriteQueue, MemoryOutboxStore> {
        val net = ManualConnectivity(online)
        val store = MemoryOutboxStore()
        val files = MemoryOutboxFiles()
        val runner = OutboxRunner(store, { SendResult.Delivered }, net, { 1_000L }, files = files)
        return WriteQueue(runner, files, net) to store
    }

    private suspend fun FinishVisitStateHolder.done() = state.first { it.phase is FinishPhase.Done }

    @Test
    fun the_fee_is_prefilled_from_priced_procedures_and_the_doctors_edit_wins() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                visitRoute,
                {
                    json(
                        detail(
                            procedure("a", "done", 50000),
                            procedure("b", "done", 70000),
                            procedure("c", "cancelled", 99999),
                            procedure("d", "done", null),
                        ),
                    )
                },
            )
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
            val holder = FinishVisitStateHolder(clinic, "v1", backgroundScope, today = { LocalDate(2026, 10, 12) })
            assertEquals(120000L, holder.state.first { it.feePaise != null }.feePaise)
            holder.setFee(90000)
            assertEquals(90000L, holder.state.value.feePaise)
            holder.setFee(0)
            assertEquals(null, holder.state.value.feePaise)
        }

    @Test
    fun the_note_is_saved_then_the_rx_then_the_finish_and_rx_is_on_by_default() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            holder.attach(sources())
            assertTrue(holder.state.value.issueRx)
            holder.pickFollowUp(FollowUpChoice.TwoWeeks)
            holder.setFee(150000)
            holder.finish(collectNow = false)
            holder.done()
            assertEquals(listOf("note", "rx", "finish"), order)
            val body = backend.finishBody().text()
            assertTrue(""""follow_up_on":"2026-10-26"""" in body, body)
            assertTrue(""""fee_paise":150000""" in body, body)
            assertTrue(""""prescription":{"id":"rx1"""" in body, body)
        }

    @Test
    fun both_buttons_send_ready_to_bill_and_only_collect_now_opens_the_collect_path() =
        runTest {
            for (collect in listOf(true, false)) {
                val backend = FakeBackend()
                val holder = open(backend, { json("""$finished,"invoice":$invoice}""") })
                holder.attach(sources(draft = null))
                holder.finish(collectNow = collect)
                val summary = (holder.done().phase as FinishPhase.Done).summary
                assertTrue(""""queue_status":"ready_to_bill"""" in backend.finishBody().text())
                assertEquals("i1", summary.invoiceId)
                assertEquals(if (collect) FinishOutcome.Collected else FinishOutcome.SentToDesk, summary.outcome)
                assertEquals(1, backend.count(finishRoute))
            }
        }

    @Test
    fun an_allergy_409_asks_for_a_reason_and_the_retry_carries_it() =
        runTest {
            val backend = FakeBackend()
            val holder =
                open(
                    backend,
                    {
                        json(
                            """{"code":"allergy_alerts","alerts":[{"kind":"allergy","message":"Penicillin","severity":"serious","line_no":1}]}""",
                            HttpStatusCode.Conflict,
                        )
                    },
                    { json("$finished}") },
                )
            holder.attach(sources())
            holder.finish(collectNow = false)
            val asked = holder.state.first { it.phase is FinishPhase.NeedsOverride }.phase as FinishPhase.NeedsOverride
            assertEquals("Penicillin", asked.alerts.single().message)
            assertTrue("override_reason" !in backend.finishBody().text())
            // No reason yet: nothing is sent.
            holder.finish(collectNow = false)
            assertEquals(1, backend.count(finishRoute))
            holder.setOverrideReason("Tolerated before")
            holder.finish(collectNow = false)
            holder.done()
            assertTrue(""""override_reason":"Tolerated before"""" in backend.finishBody().text())
            assertEquals(2, backend.count(finishRoute))
        }

    @Test
    fun a_closed_visit_gives_a_plain_message() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend, { apiError(HttpStatusCode.Conflict, "visit_closed") })
            holder.attach(sources(draft = null))
            holder.finish(collectNow = true)
            val failed = holder.state.first { it.phase is FinishPhase.Failed }.phase as FinishPhase.Failed
            assertEquals(FinishFailure.VisitClosed, failed.reason)
            assertTrue("already closed" in failed.message)
        }

    @Test
    fun offline_with_an_rx_shows_needs_connection_and_queues_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            val (writes, store) = writeQueue(online = false)
            holder.attach(sources(writes = writes))
            holder.finish(collectNow = false)
            assertEquals(FinishPhase.NeedsConnection, holder.state.value.phase)
            assertEquals(0, store.all().size)
            assertEquals(0, backend.count(finishRoute))
            assertTrue(order.isEmpty())
        }

    @Test
    fun offline_without_an_rx_queues_the_finish_for_later() =
        runTest {
            val backend = FakeBackend()
            val holder = open(backend)
            val (writes, store) = writeQueue(online = false)
            holder.attach(sources(draft = null, writes = writes))
            holder.setFee(80000)
            holder.finish(collectNow = true)
            holder.state.first { it.phase == FinishPhase.Queued }
            val entry = store.all().single()
            assertEquals(OutboxKind.VisitClose, entry.kind)
            assertEquals("visit:v1", entry.orderKey)
            assertTrue(""""feePaise":80000""" in entry.payload)
            assertEquals(0, backend.count(finishRoute))
            assertEquals(FinishOutcome.SentToDesk, holder.state.value.outcome)
            assertIs<FinishPhase.Queued>(holder.state.value.phase)
        }
}
