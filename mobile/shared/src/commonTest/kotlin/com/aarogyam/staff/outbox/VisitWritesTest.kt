package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.model.NewProcedure
import com.aarogyam.staff.device.FakeDictation
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.visit.BulletKind
import com.aarogyam.staff.visit.VisitState
import com.aarogyam.staff.visit.VisitStateHolder
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private class Recorder : OutboxSender {
    val sent = mutableListOf<OutboxEntry>()

    override suspend fun send(entry: OutboxEntry): SendResult {
        sent += entry
        return SendResult.Delivered
    }
}

private const val KEY = "visit:v1"

@OptIn(ExperimentalCoroutinesApi::class)
class VisitWritesTest {
    private val store = MemoryOutboxStore()
    private val files = MemoryOutboxFiles()
    private val net = ManualConnectivity(online = false)
    private var clock = 1_000L

    private fun runner(
        sender: OutboxSender,
        from: OutboxStore = store,
    ) = OutboxRunner(from, sender, net, { clock }, files = files)

    @Test
    fun a_visits_writes_keep_the_order_saved_and_its_close_always_goes_last() =
        runTest {
            val recorder = Recorder()
            val runner = runner(recorder)
            // Saved in the wrong order on purpose: the close first.
            runner.enqueue(OutboxKind.VisitClose, "{}", orderKey = KEY)
            runner.enqueue(OutboxKind.Procedure, "{}", orderKey = KEY)
            runner.enqueue(OutboxKind.Note, "{}", orderKey = KEY)
            runner.enqueue(OutboxKind.NoteSign, "{}", orderKey = KEY)
            val other = runner.enqueue(OutboxKind.VisitClose, "{}", orderKey = "visit:v2")
            net.online.value = true
            assertEquals(5, runner.drain())
            val order = recorder.sent.filter { it.orderKey == KEY }.map { it.kind }
            // Strictly in the order saved among the first three; a close always after every other write of its visit.
            assertEquals(OutboxKind.VisitClose, order.last())
            assertEquals(listOf(OutboxKind.Procedure, OutboxKind.Note, OutboxKind.NoteSign), order.dropLast(1))
            assertTrue(recorder.sent.any { it.id == other }, "another visit does not wait")
        }

    @Test
    fun a_refused_note_holds_back_its_visits_close_and_nothing_is_dropped() =
        runTest {
            net.online.value = true
            val sender =
                OutboxSender {
                    if (it.kind ==
                        OutboxKind.Note
                    ) {
                        SendResult.Rejected("validation_failed")
                    } else {
                        SendResult.Delivered
                    }
                }
            val runner = runner(sender)
            runner.enqueue(OutboxKind.Note, "{}", orderKey = KEY)
            runner.enqueue(OutboxKind.VisitClose, "{}", orderKey = KEY)
            assertEquals(0, runner.drain())
            assertEquals(2, store.all().size)
            assertEquals(1, runner.failed.value.size)
        }

    @Test
    fun a_newer_waiting_patch_replaces_the_older_one() =
        runTest {
            val recorder = Recorder()
            val runner = runner(recorder)
            runner.enqueue(OutboxKind.Note, """{"v":"create"}""", orderKey = KEY)
            runner.enqueue(OutboxKind.NoteEdit, """{"v":1}""", orderKey = KEY, coalesceKey = "note:n1")
            runner.enqueue(OutboxKind.NoteEdit, """{"v":2}""", orderKey = KEY, coalesceKey = "note:n1")
            val last = runner.enqueue(OutboxKind.NoteEdit, """{"v":3}""", orderKey = KEY, coalesceKey = "note:n1")
            runner.enqueue(OutboxKind.NoteEdit, """{"v":9}""", orderKey = KEY, coalesceKey = "note:n2")
            assertEquals(3, store.all().size)
            assertEquals(3, runner.pending.value)
            net.online.value = true
            runner.drain()
            assertEquals(listOf("""{"v":"create"}""", """{"v":3}""", """{"v":9}"""), recorder.sent.map { it.payload })
            assertTrue(recorder.sent.any { it.id == last })
        }

    @Test
    fun a_photo_waits_in_protected_storage_resumes_after_a_restart_and_the_file_goes_once_sent() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/patients/p1/attachments",
                {
                    json(
                        """{"id":"a1","kind":"xray","mime_type":"image/jpeg","size_bytes":3,"sha256":"${"0".repeat(
                            64,
                        )}",
                        "label":"X-ray","tooth":null,"created_at":"2026-10-02T20:00:00Z"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val first = WriteQueue(runner(Recorder()), files, net)
            val queued =
                assertIs<Queued.Saved>(first.photo(clinic.slug, "p1", "id-1", byteArrayOf(1, 2, 3), "X-ray", null))
            assertEquals(setOf("id-1.jpg"), files.names)
            // The app is killed: a new runner over the saved entries and the same files.
            val sender = VisitWriteSender({ clinic }, files)
            val again = runner(sender, MemoryOutboxStore(store.all()))
            net.online.value = true
            assertEquals(1, again.drain())
            val posts =
                backend.requests.filter {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath.endsWith("/attachments")
                }
            assertEquals(1, posts.size)
            assertTrue(files.names.isEmpty(), "the image is deleted after the upload")
            assertEquals(0, again.pending.value)
            assertEquals("id-1", queued.id)
        }

    @Test
    fun over_the_cap_a_photo_is_refused_clearly_and_nothing_is_dropped() =
        runTest {
            val runner = runner(Recorder())
            val queue = WriteQueue(runner, files, net, maxFileBytes = 10)
            assertIs<Queued.Saved>(queue.photo("sunrise", "p1", "a", ByteArray(6), null, null))
            val refused = assertIs<Queued.Refused>(queue.photo("sunrise", "p1", "b", ByteArray(6), null, null))
            assertEquals(Refusal.FilesFull, refused.why)
            assertEquals(setOf("a.jpg"), files.names)
            assertEquals(listOf("a"), store.all().map { it.id })
        }

    @Test
    fun signing_out_with_unsent_writes_is_blocked_until_the_person_agrees() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            assertEquals(SignOutResult.SignedOut, graph.trySignOut())
            graph.outbox.enqueue(OutboxKind.Procedure, "{}", orderKey = KEY)
            graph.outbox.enqueue(OutboxKind.Note, "{}", orderKey = KEY)
            assertEquals(SignOutResult.SignOutBlocked(2), graph.trySignOut())
            assertEquals(2, graph.outbox.unsentCount(), "blocked means nothing was done")
        }

    @Test
    fun a_visit_written_offline_goes_out_in_order_once_the_network_returns_and_never_twice() =
        runTest {
            val backend = FakeBackend()
            val visit = """{"id":"v1","number":"V-318","patient_id":"p1","status":"open","started_at":"2026-10-09T04:30:00Z",
                "clinician":{"id":"m1","name":"Dr. Patil"}}"""

            fun note(version: Int) =
                """{"id":"n1","visit_id":"v1","kind":"soap","source":"typed","status":"draft","sections":{},"author":{"id":"m1","name":"Dr"},
                "created_at":"2026-10-09T04:31:00Z","updated_at":"2026-10-09T04:31:00Z","row_version":$version,"addenda":[]}"""
            backend.on("$SUNRISE/api/v1/patients/p1/visits", { json(visit, HttpStatusCode.Created) })
            backend.on("$SUNRISE/api/v1/visits/v1/notes", { json(note(1), HttpStatusCode.Created) })
            backend.on("$SUNRISE/api/v1/notes/n1", { json(note(2)) })
            backend.on("$SUNRISE/api/v1/notes/n1/sign", { json(note(3).replace("\"draft\"", "\"signed\"")) })
            backend.on(
                "$SUNRISE/api/v1/visits/v1/procedures",
                {
                    json(
                        """{"id":"pr1","visit_id":"v1","name":"Filling","status":"done","surfaces":[],"clinician":{"id":"m1","name":"Dr"},
                        "created_at":"2026-10-09T04:31:00Z"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/visits/v1/finish", {
                json(
                    """{"signed_note_ids":[],"unsigned_note_ids":[],"visit":${visit.replace(
                        "\"open\"",
                        "\"closed\"",
                    )}}""",
                )
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("clinical.write"))
            val runner = runner(VisitWriteSender({ clinic }, files))
            val writes = WriteQueue(runner, files, net)
            val holder = VisitStateHolder(clinic, "p1", null, null, FakeDictation(), backgroundScope, writes = writes)
            holder.state.first { it is VisitState.Open }
            holder.addBullet(BulletKind.Complaint, "Pain on 36")
            advanceTimeBy(1_000)
            holder.addBullet(BulletKind.Finding, "Deep caries")
            advanceTimeBy(1_000)
            holder.addBullet(BulletKind.Advice, "RCT")
            advanceTimeBy(1_000)
            writes.procedure(clinic.slug, "v1", NewProcedure(name = "Filling", tooth = 36, status = "done"))
            holder.sign()
            runCurrent()
            holder.close()
            runCurrent()
            val view = (holder.state.value as VisitState.Open).view
            assertTrue(view.noteSync && view.closeSync && view.closed, "shown as saved, waiting to send")
            assertEquals(0, backend.count("$SUNRISE/api/v1/visits/v1/notes"), "nothing sent while offline")
            // Three edits made, one PATCH kept: create, PATCH, procedure, sign, close.
            assertEquals(5, store.all().size)
            net.online.value = true
            assertEquals(5, runner.drain())
            val order =
                backend.requests
                    .filter { it.method != HttpMethod.Get && it.url.encodedPath != "/api/v1/patients/p1/visits" }
                    .map { "${it.method.value} ${it.url.encodedPath}" }
                    .filter { it.contains("/notes") || it.contains("/procedures") || it.contains("/finish") }
            // The sign saves the note once more, so its PATCH (the one kept) follows the procedure.
            assertEquals(
                listOf(
                    "POST /api/v1/visits/v1/notes",
                    "POST /api/v1/visits/v1/procedures",
                    "PATCH /api/v1/notes/n1",
                    "POST /api/v1/notes/n1/sign",
                    "POST /api/v1/visits/v1/finish",
                ),
                order,
            )
            // Restart after delivery: nothing is sent again.
            val restarted = runner(VisitWriteSender({ clinic }, files), MemoryOutboxStore(store.all()))
            assertEquals(0, restarted.drain())
            assertEquals(1, backend.count("$SUNRISE/api/v1/visits/v1/notes"))
            assertEquals(1, backend.count("$SUNRISE/api/v1/visits/v1/finish"))
            assertEquals(1, backend.count("$SUNRISE/api/v1/visits/v1/procedures"))
        }
}
