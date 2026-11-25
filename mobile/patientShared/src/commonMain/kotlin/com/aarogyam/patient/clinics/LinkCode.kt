package com.aarogyam.patient.clinics

/**
 * Reads a clinic's link code (`XXXXX-XXXXX`) from what a QR card holds: the code itself, or an
 * `aarogyam://` link carrying it (`aarogyam://link#CODE` or `?code=CODE`). Anything else, such as
 * a web address or another app's link, is not ours and gives null.
 */
object LinkCode {
    private const val SCHEME = "aarogyam://"
    private const val LENGTH = 10
    private const val HALF = 5

    /** The code as `XXXXX-XXXXX`, or null when [scanned] isn't a link code of ours. */
    fun parse(scanned: String): String? {
        val text = scanned.trim()
        val raw =
            if (text.contains("://")) {
                if (!text.startsWith(SCHEME, ignoreCase = true)) return null
                fromLink(text.substring(SCHEME.length))
            } else {
                text
            } ?: return null
        if (raw.any { it != '-' && !(it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9') }) return null
        val code = raw.filter { it != '-' }.uppercase()
        if (code.length != LENGTH) return null
        return code.take(HALF) + "-" + code.drop(HALF)
    }

    private fun fromLink(rest: String): String? {
        val fragment = rest.substringAfter('#', "")
        if (fragment.isNotEmpty()) return fragment
        val query = rest.substringAfter('?', "").substringBefore('#')
        return query.split('&').firstOrNull { it.startsWith("code=") }?.removePrefix("code=")
    }
}
