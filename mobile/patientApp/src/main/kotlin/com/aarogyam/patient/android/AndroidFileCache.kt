package com.aarogyam.patient.android

import com.aarogyam.patient.files.FileCache
import java.io.File

/** Downloaded files in the app's cache directory only: private to the app and cleared by the system. */
class AndroidFileCache(
    cacheDir: File,
) : FileCache {
    private val directory = File(cacheDir, "shared-files")

    override fun save(
        name: String,
        bytes: ByteArray,
    ): String? =
        runCatching {
            directory.mkdirs()
            File(directory, name).also { it.writeBytes(bytes) }.path
        }.getOrNull()

    override fun clear() {
        directory.deleteRecursively()
    }
}
