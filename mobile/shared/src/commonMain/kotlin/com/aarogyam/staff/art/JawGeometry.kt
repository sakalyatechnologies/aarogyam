package com.aarogyam.staff.art

import com.aarogyam.staff.chart.Dentition
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/** Where a tooth sits on the 2.5D jaw, as shares (0 to 1) of the jaw box; [upper] arch or lower. */
data class JawSpot(
    val tooth: Int,
    val x: Double,
    val y: Double,
    val upper: Boolean,
)

/**
 * The v7 jaw: each arch's teeth on half an ellipse (44% wide, 40% tall, squashed to 98%), upper arch
 * above the middle, as in the mockup's chart. Teeth are spaced evenly along the curve as drawn in a
 * box [aspect] times wider than tall, so the molars at the ends don't pile up on a wide screen.
 * Works for adult and child teeth.
 */
object JawGeometry {
    private const val RX = 0.44
    private const val RY = 0.40
    private const val SQUASH = 0.98
    private const val MID = 0.5
    private const val STEPS = 720

    /** Room left between neighbouring teeth, as a share of their spacing. */
    private const val GAP = 0.9

    /** The mockup's jaw box on a phone: about 400 by 240 points. */
    const val PHONE_ASPECT = 1.65

    /** The spots of [dentition], upper arch first, each arch left to right as the clinician faces the patient. */
    fun spots(
        dentition: Dentition,
        aspect: Double = PHONE_ASPECT,
    ): List<JawSpot> {
        val angles = Arch(aspect)
        return arch(dentition.upper, true, angles) + arch(dentition.lower, false, angles)
    }

    /** The widest a tooth can be, as a share of the box width, before neighbours on [dentition] touch. */
    fun toothShare(
        dentition: Dentition,
        aspect: Double = PHONE_ASPECT,
    ): Double {
        val most = maxOf(dentition.upper.size, dentition.lower.size).coerceAtLeast(1)
        return Arch(aspect).length / most / aspect * GAP
    }

    private fun arch(
        teeth: List<Int>,
        upper: Boolean,
        arch: Arch,
    ): List<JawSpot> =
        teeth.mapIndexed { i, tooth ->
            val angle = arch.angleAt((i + MID) / teeth.size)
            val dy = RY * sin(angle) * SQUASH
            JawSpot(tooth, MID + RX * cos(angle), if (upper) MID - dy else MID + dy, upper)
        }

    /** Half the ellipse from the left end (angle pi) to the right (0), measured in box heights. */
    private class Arch(
        aspect: Double,
    ) {
        private val walked = DoubleArray(STEPS + 1)

        init {
            var x = point(0, aspect).first
            var y = point(0, aspect).second
            for (k in 1..STEPS) {
                val (nx, ny) = point(k, aspect)
                walked[k] = walked[k - 1] + hypot(nx - x, ny - y)
                x = nx
                y = ny
            }
        }

        val length: Double get() = walked[STEPS]

        /** The angle a [share] of the way along the arch. */
        fun angleAt(share: Double): Double {
            val target = share * length
            var k = 1
            while (k < STEPS && walked[k] < target) k++
            val part = (target - walked[k - 1]) / (walked[k] - walked[k - 1])
            return PI * (1 - (k - 1 + part) / STEPS)
        }

        private fun point(
            k: Int,
            aspect: Double,
        ): Pair<Double, Double> {
            val angle = PI * (1 - k.toDouble() / STEPS)
            return RX * aspect * cos(angle) to RY * SQUASH * sin(angle)
        }
    }
}
