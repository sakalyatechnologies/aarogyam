package com.aarogyam.staff.outbox

import android.content.Context
import java.io.File
import java.io.IOException

/**
 * Queued photos in `Context.noBackupFilesDir/outbox`: app-private internal storage, excluded from
 * Auto Backup and device transfer. File names are the entry ids, never anything about the patient.
 *
 * Android has no equivalent of iOS `NSFileProtectionComplete`. Internal storage is acceptable here:
 * the directory is readable only by this app's uid (other apps and `adb` without root cannot open
 * it), and on every supported device (minSdk 26) it sits under file-based encryption, so it is
 * unreadable before the first unlock. `EncryptedFile` (security-crypto) is deliberately not used:
 * the library is deprecated, and it would add a dependency for little gain over FBE. Files are
 * removed as soon as they are delivered, discarded or at sign-out.
 *
 * Writes go to a temporary file in the same directory, then rename over the real one, so a reader
 * (or a restart) sees the old bytes or the new bytes, never half of a photo.
 */
class AndroidOutboxFiles(
    private val directory: File,
) : OutboxFiles {
    constructor(context: Context) : this(File(context.noBackupFilesDir, "outbox"))

    private val dir: File
        get() = directory.also { if (!it.isDirectory) it.mkdirs() }

    override fun write(
        name: String,
        bytes: ByteArray,
    ) {
        val target = fileFor(name)
        val tmp = File(dir, "$name$TMP")
        try {
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(target)) {
                target.delete()
                if (!tmp.renameTo(target)) throw IOException("write_failed")
            }
        } finally {
            if (tmp.exists()) tmp.delete()
        }
    }

    override fun read(name: String): ByteArray? = fileFor(name).takeIf { it.isFile }?.readBytes()

    override fun delete(name: String) {
        fileFor(name).delete()
    }

    override fun totalBytes(): Long = stored().sumOf { it.length() }

    /** Names of every stored file, oldest write first (ties by name). Leftover temp files are not listed. */
    fun list(): List<String> = stored().sortedWith(compareBy({ it.lastModified() }, { it.name })).map { it.name }

    /** Deletes every stored file, including leftover temp files. For sign-out. */
    override fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun stored(): List<File> = dir.listFiles()?.filter { it.isFile && !it.name.endsWith(TMP) } ?: emptyList()

    private fun fileFor(name: String): File {
        require(name.isNotEmpty() && '/' !in name && name != "." && name != ".." && !name.endsWith(TMP)) { "bad_name" }
        return File(dir, name)
    }

    private companion object {
        const val TMP = ".tmp"
    }
}
