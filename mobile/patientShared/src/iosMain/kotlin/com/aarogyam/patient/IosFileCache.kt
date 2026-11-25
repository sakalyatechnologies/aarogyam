package com.aarogyam.patient

import com.aarogyam.patient.files.FileCache
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSCachesDirectory
import platform.Foundation.NSData
import platform.Foundation.NSFileManager
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSUserDomainMask
import platform.Foundation.create
import platform.Foundation.writeToFile

/** Downloaded files in the app's Caches directory: the system may clear it, and it is never backed up. */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class IosFileCache : FileCache {
    private val directory: String =
        (
            NSSearchPathForDirectoriesInDomains(
                NSCachesDirectory,
                NSUserDomainMask,
                true,
            ).firstOrNull() as? String ?: ""
        ) +
            "/shared-files"

    override fun save(
        name: String,
        bytes: ByteArray,
    ): String? {
        NSFileManager.defaultManager.createDirectoryAtPath(directory, true, null, null)
        val path = "$directory/$name"
        val data =
            if (bytes.isEmpty()) {
                NSData()
            } else {
                bytes.usePinned { NSData.create(bytes = it.addressOf(0), length = bytes.size.toULong()) }
            }
        return if (data.writeToFile(path, atomically = true)) path else null
    }

    override fun clear() {
        NSFileManager.defaultManager.removeItemAtPath(directory, null)
    }
}
