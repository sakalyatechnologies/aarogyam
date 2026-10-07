package com.aarogyam.staff.files

import kotlin.math.max
import kotlin.math.roundToInt

/** Labels the phone offers first; the doctor can type their own. Same list as the web. */
val PRESET_LABELS: List<String> = listOf("OPG", "Intraoral – upper", "Intraoral – lower", "X-ray", "Consent")

/** Longest label the API takes. */
const val MAX_LABEL_LENGTH = 60

/** How a photo is shrunk on the device before it is sent: the longest side and the JPEG quality. */
object PhotoLimits {
    const val MAX_EDGE = 2048
    const val JPEG_QUALITY = 85

    /** The API refuses more than 10 MB; a resized photo is far below it, but a bigger one is not sent. */
    const val MAX_BYTES = 10 * 1024 * 1024

    /** The size [width] x [height] shrinks to so that its longest side is at most [MAX_EDGE]; never enlarges. */
    fun fit(
        width: Int,
        height: Int,
    ): Pair<Int, Int> {
        val longest = max(width, height)
        if (longest <= MAX_EDGE || width <= 0 || height <= 0) return width to height
        val scale = MAX_EDGE.toDouble() / longest
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }
}

/** The label trimmed, or null when blank; null as well when over [MAX_LABEL_LENGTH], so callers can tell. */
fun cleanLabel(text: String?): String? = text?.trim()?.takeIf { it.isNotEmpty() }

/** A valid FDI tooth number (11 to 48, or 51 to 85 for baby teeth). */
fun isFdiTooth(n: Int): Boolean {
    val quadrant = n / 10
    val position = n % 10
    return (quadrant in 1..4 && position in 1..8) || (quadrant in 5..8 && position in 1..5)
}

/** The file kind the API stores for a label: X-rays and OPGs are `xray`, consents `consent`, the rest `photo`. */
fun kindFor(label: String?): String =
    when (label) {
        "OPG", "X-ray" -> "xray"
        "Consent" -> "consent"
        else -> "photo"
    }
