package com.aarogyam.staff.outbox

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSApplicationSupportDirectory
import platform.Foundation.NSData
import platform.Foundation.NSDataWritingAtomic
import platform.Foundation.NSDataWritingFileProtectionComplete
import platform.Foundation.NSDate
import platform.Foundation.NSFileManager
import platform.Foundation.NSFileProtectionComplete
import platform.Foundation.NSFileProtectionKey
import platform.Foundation.NSString
import platform.Foundation.NSURL
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.NSUserDomainMask
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Foundation.timeIntervalSince1970
import platform.Foundation.writeToFile

/**
 * The outbox file in the app's Application Support directory (private to the app, never shared),
 * with `NSFileProtectionComplete`: unreadable while the phone is locked. Writes go to
 * `outbox.json.tmp`, then replace `outbox.json`.
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class ProtectedOutboxFile(
    private val name: String = "outbox.json",
) : OutboxFile {
    private val fm = NSFileManager.defaultManager

    private val directory: String by lazy {
        val base =
            (fm.URLsForDirectory(NSApplicationSupportDirectory, NSUserDomainMask).firstOrNull() as? NSURL)?.path
                ?: error("no_app_support")
        val dir = "$base/aarogyam"
        fm.createDirectoryAtPath(
            dir,
            withIntermediateDirectories = true,
            attributes = mapOf(NSFileProtectionKey to NSFileProtectionComplete),
            error = null,
        )
        dir
    }

    private val path get() = "$directory/$name"

    override fun read(): String? {
        if (!fm.fileExistsAtPath(path)) return null
        val data = NSData.create(contentsOfFile = path) ?: error("unreadable")
        return NSString.create(data = data, encoding = NSUTF8StringEncoding)?.toString() ?: error("not_utf8")
    }

    override fun writeAtomically(text: String) {
        val data = NSString.create(string = text).dataUsingEncoding(NSUTF8StringEncoding) ?: error("encode")
        val tmp = "$path.tmp"
        check(
            data.writeToFile(tmp, NSDataWritingAtomic or NSDataWritingFileProtectionComplete, null),
        ) { "write_failed" }
        if (fm.fileExistsAtPath(path)) fm.removeItemAtPath(path, null)
        check(fm.moveItemAtPath(tmp, toPath = path, error = null)) { "rename_failed" }
    }

    override fun moveAside() {
        val stamp = NSDate().timeIntervalSince1970.toLong()
        fm.moveItemAtPath(path, toPath = "$directory/$name.corrupt-$stamp", error = null)
    }
}
