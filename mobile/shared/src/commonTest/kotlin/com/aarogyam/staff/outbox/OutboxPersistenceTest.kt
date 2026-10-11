package com.aarogyam.staff.outbox

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.auth.SessionState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A file held in memory; [writes] counts the atomic writes, [aside] the files moved out of the way. */
private class FakeFile(
    var text: String? = null,
) : OutboxFile {
    var writes = 0
    val aside = mutableListOf<String>()

    override fun read() = text

    override fun writeAtomically(text: String) {
        writes++
        this.text = text
    }

    override fun moveAside() {
        aside += checkNotNull(text)
        text = null
    }
}

private fun entry(
    id: String,
    kind: OutboxKind = OutboxKind.Note,
    status: OutboxStatus = OutboxStatus.Pending,
) = OutboxEntry(
    id,
    kind,
    """{"body":"Asha Patil"}""",
    createdAt = 5,
    attempts = 2,
    nextAttemptAt = 9,
    status = status,
    lastError = "offline",
)

private fun storeOver(file: OutboxFile) = PersistentOutboxStore(JsonOutboxPersistence(file))

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxPersistenceTest {
    @Test
    fun aStoreRoundTripsEveryField() {
        val file = FakeFile()
        val first = storeOver(file)
        first.put(entry("a"))
        first.put(entry("b", OutboxKind.Payment, OutboxStatus.Failed))
        val again = storeOver(file).all()
        assertEquals(first.all(), again)
        assertEquals("""{"body":"Asha Patil"}""", again.first().payload)
        assertEquals(9, again.first().nextAttemptAt)
        assertEquals(OutboxStatus.Failed, again.last().status)
    }

    @Test
    fun aCorruptedFileIsMovedAsideNotThrown() {
        val file = FakeFile("{not json Asha")
        val store = storeOver(file)
        assertTrue(store.all().isEmpty())
        assertEquals(listOf("{not json Asha"), file.aside)
        store.put(entry("a")) // and the queue works afterwards
        assertEquals(1, storeOver(file).all().size)
        val badKind = FakeFile("""{"version":1,"entries":[{"id":"x","kind":"Nope","payload":"","createdAt":1}]}""")
        assertTrue(storeOver(badKind).all().isEmpty())
        assertEquals(1, badKind.aside.size)
    }

    @Test
    fun anUnreadableFileIsLeftAloneAndNeverOverwritten() {
        val file =
            object : OutboxFile {
                var wrote = false

                override fun read(): String = error("locked")

                override fun writeAtomically(text: String) {
                    wrote = true
                }

                override fun moveAside() = error("must not move")
            }
        val store = storeOver(file)
        store.put(entry("a"))
        assertFalse(file.wrote)
        assertEquals(1, store.all().size) // still sends this run
    }

    @Test
    fun theFileIsCappedAt500AndFailedEntriesGoFirst() {
        val file = FakeFile()
        val store = storeOver(file)
        repeat(OUTBOX_MAX_ENTRIES) {
            store.put(
                entry(
                    "e$it",
                    status =
                        if (it ==
                            3
                        ) {
                            OutboxStatus.Failed
                        } else {
                            OutboxStatus.Pending
                        },
                ),
            )
        }
        assertEquals(OUTBOX_MAX_ENTRIES, store.all().size)
        store.put(entry("e0")) // replacing in place is not growth
        store.put(entry("new")) // evicts the one failed entry
        assertEquals(OUTBOX_MAX_ENTRIES, store.all().size)
        assertNull(store.all().firstOrNull { it.id == "e3" })
        assertEquals("new", store.all().last().id)
        assertFailsWith<OutboxFullException> { store.put(entry("over")) }
        assertEquals(OUTBOX_MAX_ENTRIES, storeOver(file).all().size)
    }

    @Test
    fun aRestartResumesSendingOnceWithTheSameKey() =
        runTest {
            val file = FakeFile()
            val net = ManualConnectivity(online = false)
            var clock = 1_000L
            val killed = OutboxRunner(storeOver(file), { error("offline") }, net, { clock })
            val id = killed.enqueue(OutboxKind.Payment, """{"amount":500}""")
            // The app is killed here; a new process opens the same file.
            net.online.value = true
            val sent = mutableListOf<OutboxEntry>()
            val revived =
                OutboxRunner(storeOver(file), {
                    sent += it
                    SendResult.Delivered
                }, net, { clock })
            assertEquals(1, revived.pending.value)
            assertEquals(1, revived.drain())
            assertEquals(listOf(id), sent.map { it.id })
            assertEquals("""{"amount":500}""", sent.single().payload)
            // Another restart finds nothing to send.
            val third =
                OutboxRunner(storeOver(file), {
                    sent += it
                    SendResult.Delivered
                }, net, { clock })
            assertEquals(0, third.drain())
            assertEquals(1, sent.size)
        }

    @Test
    fun signOutEmptiesTheQueueAndTheFile() =
        runTest {
            val file = FakeFile()
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope, outboxStore = storeOver(file))
            signIn(graph, backend)
            graph.outbox.enqueue(OutboxKind.Note, """{"body":"Asha Patil"}""")
            assertEquals(1, graph.outbox.pending.value)
            assertTrue(file.text.orEmpty().contains("Asha"))
            graph.signOut()
            graph.outbox.pending.first { it == 0 }
            graph.sessionState.first { it is SessionState.SignedOut }
            assertEquals(0, graph.outbox.pending.value)
            assertFalse(file.text.orEmpty().contains("Asha"))
            assertTrue(storeOver(file).all().isEmpty())
        }
}
