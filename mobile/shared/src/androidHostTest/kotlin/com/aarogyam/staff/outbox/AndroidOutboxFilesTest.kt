package com.aarogyam.staff.outbox

import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AndroidOutboxFilesTest {
    private val root: File = Files.createTempDirectory("outbox-test").toFile()
    private val dir = File(root, "outbox")

    @AfterTest
    fun cleanup() {
        root.deleteRecursively()
    }

    @Test
    fun writeThenRead() {
        val files = AndroidOutboxFiles(dir)
        files.write("a", byteArrayOf(1, 2, 3))
        assertContentEquals(byteArrayOf(1, 2, 3), files.read("a"))
        assertNull(files.read("missing"))
        assertEquals(3L, files.totalBytes())
    }

    @Test
    fun overwriteReplacesAndLeavesNoTempFile() {
        val files = AndroidOutboxFiles(dir)
        files.write("a", byteArrayOf(1, 2, 3))
        files.write("a", byteArrayOf(9))
        assertContentEquals(byteArrayOf(9), files.read("a"))
        assertEquals(listOf("a"), dir.list()!!.toList())
        assertEquals(1L, files.totalBytes())
    }

    @Test
    fun deleteRemovesOnlyThatFile() {
        val files = AndroidOutboxFiles(dir)
        files.write("a", byteArrayOf(1))
        files.write("b", byteArrayOf(2))
        files.delete("a")
        files.delete("never-there")
        assertNull(files.read("a"))
        assertEquals(listOf("b"), files.list())
    }

    @Test
    fun listIsOldestFirstThenByName() {
        val files = AndroidOutboxFiles(dir)
        listOf("c" to 3000L, "a" to 1000L, "b" to 2000L, "d" to 2000L).forEach { (n, t) ->
            files.write(n, byteArrayOf(1))
            assertTrue(File(dir, n).setLastModified(t))
        }
        assertEquals(listOf("a", "b", "d", "c"), files.list())
    }

    @Test
    fun listIgnoresLeftoverTempFiles() {
        val files = AndroidOutboxFiles(dir)
        files.write("a", byteArrayOf(1))
        File(dir, "b.tmp").writeBytes(byteArrayOf(1, 1))
        assertEquals(listOf("a"), files.list())
        assertEquals(1L, files.totalBytes())
    }

    @Test
    fun clearRemovesEverything() {
        val files = AndroidOutboxFiles(dir)
        files.write("a", byteArrayOf(1))
        files.write("b", byteArrayOf(2))
        File(dir, "c.tmp").writeBytes(byteArrayOf(3))
        files.clear()
        assertEquals(emptyList(), files.list())
        assertEquals(0L, files.totalBytes())
        assertEquals(0, dir.list()!!.size)
        files.write("d", byteArrayOf(4))
        assertContentEquals(byteArrayOf(4), files.read("d"))
    }

    @Test
    fun survivesANewInstance() {
        AndroidOutboxFiles(dir).apply {
            write("a", byteArrayOf(1, 2))
            write("b", byteArrayOf(3))
        }
        val restarted = AndroidOutboxFiles(dir)
        assertContentEquals(byteArrayOf(1, 2), restarted.read("a"))
        assertEquals(setOf("a", "b"), restarted.list().toSet())
        assertEquals(3L, restarted.totalBytes())
    }

    @Test
    fun emptyFileRoundTrips() {
        val files = AndroidOutboxFiles(dir)
        files.write("e", ByteArray(0))
        assertContentEquals(ByteArray(0), files.read("e"))
    }
}
