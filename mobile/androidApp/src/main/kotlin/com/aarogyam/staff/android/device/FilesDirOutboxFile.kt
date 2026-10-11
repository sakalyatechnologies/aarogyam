package com.aarogyam.staff.android.device

import android.content.Context
import com.aarogyam.staff.outbox.OutboxFile
import java.io.File

/**
 * The outbox file in `context.filesDir`: private to the app, excluded from other apps, encrypted at
 * rest by Android file-based encryption. Writes go to a temporary file, then rename over the real one.
 */
class FilesDirOutboxFile(
    context: Context,
    private val name: String = "outbox.json",
) : OutboxFile {
    private val dir = File(context.filesDir, "aarogyam").apply { mkdirs() }
    private val file get() = File(dir, name)

    override fun read(): String? = file.takeIf { it.exists() }?.readText(Charsets.UTF_8)

    override fun writeAtomically(text: String) {
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            check(tmp.renameTo(file)) { "rename_failed" }
        }
    }

    override fun moveAside() {
        file.renameTo(File(dir, "$name.corrupt-${System.currentTimeMillis()}"))
    }
}
