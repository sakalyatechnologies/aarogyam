package com.aarogyam.staff.outbox

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSData
import platform.Foundation.NSDataWritingAtomic
import platform.Foundation.NSDataWritingFileProtectionComplete
import platform.Foundation.NSFileManager
import platform.Foundation.NSFileProtectionComplete
import platform.Foundation.NSFileProtectionKey
import platform.Foundation.NSFileSize
import platform.Foundation.NSNumber
import platform.Foundation.NSURL
import platform.Foundation.NSUserDomainMask
import platform.Foundation.create
import platform.Foundation.writeToFile
import platform.posix.memcpy

/**
 * Queued photos in the app's Application Support directory (`aarogyam/outbox-files`), private to the
 * app, with `NSFileProtectionComplete`: unreadable while the phone is locked. File names are the
 * entry ids, never anything about the patient.
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class ProtectedOutboxFiles : OutboxFiles {
    private val fm = NSFileManager.defaultManager

    private val directory: String by lazy {
        val base =
            (fm.URLsForDirectory(NSApplicationSupportDirectory, NSUserDomainMask).firstOrNull() as? NSURL)?.path
                ?: error("no_app_support")
        val dir = "$base/aarogyam/outbox-files"
        fm.createDirectoryAtPath(
            dir,
            withIntermediateDirectories = true,
            attributes = mapOf(NSFileProtectionKey to NSFileProtectionComplete),
            error = null,
        )
        dir
    }

    override fun write(
        name: String,
        bytes: ByteArray,
    ) {
        val data =
            if (bytes.isEmpty()) {
                NSData()
            } else {
                bytes.usePinned {
                    NSData.create(bytes = it.addressOf(0), length = bytes.size.toULong())
                }
            }
        check(data.writeToFile("$directory/$name", NSDataWritingAtomic or NSDataWritingFileProtectionComplete, null)) {
            "write_failed"
        }
    }

    override fun read(name: String): ByteArray? {
        val data = NSData.create(contentsOfFile = "$directory/$name") ?: return null
        val out = ByteArray(data.length.toInt())
        if (out.isNotEmpty()) out.usePinned { memcpy(it.addressOf(0), data.bytes, data.length) }
        return out
    }

    override fun delete(name: String) {
        fm.removeItemAtPath("$directory/$name", null)
    }

    override fun totalBytes(): Long =
        (fm.contentsOfDirectoryAtPath(directory, null) ?: emptyList<Any?>()).sumOf { entry ->
            val attrs = fm.attributesOfItemAtPath("$directory/$entry", null)
            (attrs?.get(NSFileSize) as? NSNumber)?.longLongValue ?: 0L
        }
}
