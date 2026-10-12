package com.aarogyam.staff.art

import com.aarogyam.staff.chart.Dentition
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Where a tooth sits on the 2.5D jaw, as shares (0 to 1) of the jaw box; [upper] arch or lower. */
data class JawSpot(
    val tooth: Int,
    val x: Double,
    val y: Double,
    val upper: Boolean,
)

/**
 * The v7 jaw: each arch's teeth spaced evenly on half an ellipse (44% wide, 40% tall, squashed to
 * 98%), upper arch above the middle, as in the mockup's chart. Works for adult and child teeth.
 */
object JawGeometry {
    private const val RX = 0.44
    private const val RY = 0.40
    private const val SQUASH = 0.98
    private const val MID = 0.5

    /** The spots of [dentition], upper arch first, each arch left to right as the clinician faces the patient. */
    fun spots(dentition: Dentition): List<JawSpot> = arch(dentition.upper, true) + arch(dentition.lower, false)

    private fun arch(
        teeth: List<Int>,
        upper: Boolean,
    ): List<JawSpot> =
        teeth.mapIndexed { i, tooth ->
            val t = (i + MID) / teeth.size
            val angle = PI * (1 - t)
            val dy = RY * sin(angle) * SQUASH
            JawSpot(tooth, MID + RX * cos(angle), if (upper) MID - dy else MID + dy, upper)
        }
}
