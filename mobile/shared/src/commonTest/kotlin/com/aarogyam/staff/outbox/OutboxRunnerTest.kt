package com.aarogyam.staff.outbox

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Answers from a script, then "delivered"; records every entry sent. */
private class FakeSender(
    private val script: MutableList<SendResult> = mutableListOf(),
) : OutboxSender {
    val sent = mutableListOf<OutboxEntry>()

    override suspend fun send(entry: OutboxEntry): SendResult {
        sent += entry
        return if (script.isEmpty()) SendResult.Delivered else script.removeAt(0)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class OutboxRunnerTest {
    private var clock = 1_000L
    private val store = MemoryOutboxStore()
    private val net = ManualConnectivity(online = false)

    private fun runner(
        sender: OutboxSender,
        store: OutboxStore = this.store,
    ) = OutboxRunner(store, sender, net, { clock })

    @Test
    fun offlineEnqueueThenOnlineSendsOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val sender = FakeSender()
            val runner = runner(sender)
            val job = runner.start(this)
            val id = runner.enqueue(OutboxKind.Note, """{"body":"x"}""")
            assertEquals(1, runner.pending.value)
            assertTrue(sender.sent.isEmpty())
            net.online.value = true
            assertEquals(listOf(id), sender.sent.map { it.id })
            assertEquals(0, runner.pending.value)
            assertTrue(store.all().isEmpty())
            net.online.value = false
            net.online.value = true
            assertEquals(1, sender.sent.size)
            job.cancel()
        }

    @Test
    fun serverErrorRetriesWithTheSameKeyAndBacksOff() =
        runTest {
            net.online.value = true
            val sender = FakeSender(mutableListOf(SendResult.Retry("server_error"), SendResult.Retry("offline")))
            val runner = runner(sender)
            val id = runner.enqueue(OutboxKind.Payment, "{}")
            assertEquals(0, runner.drain())
            assertEquals(1, store.all().single().attempts)
            assertEquals(clock + 2_000, store.all().single().nextAttemptAt)
            assertEquals(0, runner.drain()) // not due yet
            assertEquals(1, sender.sent.size)
            clock += 2_000
            runner.drain()
            assertEquals(clock + 4_000, store.all().single().nextAttemptAt)
            clock += 4_000
            assertEquals(1, runner.drain())
            assertEquals(listOf(id, id, id), sender.sent.map { it.id })
            assertEquals(0, runner.pending.value)
        }

    @Test
    fun backoffIsCapped() =
        runTest {
            net.online.value = true
            val runner = OutboxRunner(store, FakeSender(MutableList(30) { SendResult.Retry("x") }), net, { clock }, 2_000, 10_000)
            runner.enqueue(OutboxKind.Note, "{}")
            repeat(8) {
                runner.drain()
                val due = store.all().single().nextAttemptAt
                assertTrue(due - clock <= 10_000)
                if (it == 7) assertEquals(10_000, due - clock)
                clock = due
            }
        }

    @Test
    fun rejectionStopsTheEntryButKeepsItAndLaterOnesGo() =
        runTest {
            net.online.value = true
            val sender = FakeSender(mutableListOf(SendResult.Rejected("validation_failed")))
            val runner = runner(sender)
            val bad = runner.enqueue(OutboxKind.Note, "{}")
            runner.enqueue(OutboxKind.Note, "{}")
            assertEquals(1, runner.drain())
            assertEquals(listOf(bad), runner.failed.value.map { it.id })
            assertEquals("validation_failed", runner.failed.value.single().lastError)
            assertEquals(0, runner.pending.value)
            runner.drain()
            assertEquals(2, sender.sent.size) // the failed one is not sent again
            runner.retry(bad)
            assertEquals(1, runner.pending.value)
        }

    @Test
    fun orderIsFifoPerKindAndABackingOffHeadHoldsItsKind() =
        runTest {
            net.online.value = true
            val sender = FakeSender(mutableListOf(SendResult.Retry("server_error")))
            val runner = runner(sender)
            val n1 = runner.enqueue(OutboxKind.Note, "1")
            val n2 = runner.enqueue(OutboxKind.Note, "2")
            val p1 = runner.enqueue(OutboxKind.Photo, "3")
            runner.drain()
            assertEquals(listOf(n1, p1), sender.sent.map { it.id }) // n2 waits behind n1; photo not blocked
            clock += 2_000
            runner.drain()
            assertEquals(listOf(n1, p1, n1, n2), sender.sent.map { it.id })
        }

    @Test
    fun restartOverTheSameStoreDoesNotSendTwice() =
        runTest {
            net.online.value = true
            val first = FakeSender()
            val a = runner(first)
            a.enqueue(OutboxKind.VisitClose, "{}")
            a.drain()
            val second = FakeSender()
            val b = runner(second)
            assertEquals(0, b.pending.value)
            b.drain()
            assertTrue(second.sent.isEmpty())
        }

    @Test
    fun restartAfterACrashMidSendResendsWithTheSameId() =
        runTest {
            net.online.value = true
            val crash = OutboxSender { throw IllegalStateException("boom: Asha Patil") }
            val a = runner(crash)
            val id = a.enqueue(OutboxKind.Photo, "{}")
            a.drain()
            assertEquals("send_exception", store.all().single().lastError)
            clock += 10_000
            val second = FakeSender()
            runner(second).drain()
            assertEquals(listOf(id), second.sent.map { it.id })
        }

    @Test
    fun persistenceSurvivesAndNothingSensitiveIsPrinted() {
        var saved = emptyList<OutboxEntry>()
        val persistence =
            object : OutboxPersistence {
                override fun load() = saved

                override fun save(entries: List<OutboxEntry>) {
                    saved = entries
                }
            }
        PersistentOutboxStore(persistence).put(OutboxEntry("a", OutboxKind.Note, """{"body":"Asha Patil"}""", 1))
        val again = PersistentOutboxStore(persistence)
        assertEquals(1, again.all().size)
        assertFalse(again.all().single().toString().contains("Asha"))
    }
}
