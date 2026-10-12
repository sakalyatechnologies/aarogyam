package com.aarogyam.staff.art

/** A colour stop of an [ArtPaint.Linear] or [ArtPaint.Radial] gradient. */
data class ArtStop(
    val offset: Double,
    val color: ArtColor,
    val opacity: Double = 1.0,
)

/** A colour in the art: fixed, a theme role (follows the clinic's brand), or the text colour. */
sealed interface ArtColor {
    /** `#rrggbb` with an extra [alpha]. */
    data class Fixed(
        val hex: String,
        val alpha: Double = 1.0,
    ) : ArtColor

    /** A theme role by its design-token name (`primary`, `primaryContainer`, `background`...). */
    data class Role(
        val name: String,
    ) : ArtColor

    /** The surrounding text colour (icons). */
    data object Current : ArtColor
}

/** How a layer is filled or stroked. Gradient coordinates are in the layer's user space (or its box when [boxUnits]). */
sealed interface ArtPaint {
    data object None : ArtPaint

    data class Solid(
        val color: ArtColor,
    ) : ArtPaint

    data class Linear(
        val x1: Double,
        val y1: Double,
        val x2: Double,
        val y2: Double,
        val stops: List<ArtStop>,
        val boxUnits: Boolean,
    ) : ArtPaint

    data class Radial(
        val cx: Double,
        val cy: Double,
        val r: Double,
        val stops: List<ArtStop>,
        val boxUnits: Boolean,
    ) : ArtPaint
}

/** A decorative loop on a group of layers; layers with the same [node] move together around their shared box. */
data class ArtLoop(
    val kind: String,
    val node: Int,
)

/** One shape of a picture, drawn in order. [path] is SVG path data; [matrix] is `a b c d e f` (SVG order). */
data class ArtLayer(
    val path: String,
    val matrix: List<Double> = IDENTITY,
    val fill: ArtPaint = ArtPaint.None,
    val stroke: ArtPaint = ArtPaint.None,
    val strokeWidth: Double = 1.0,
    val opacity: Double = 1.0,
    val roundCaps: Boolean = false,
    val roundJoins: Boolean = false,
    val loops: List<ArtLoop> = emptyList(),
) {
    companion object {
        val IDENTITY: List<Double> = listOf(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    }
}

/** A whole picture: an icon, an avatar or an illustration, in its own [viewBox] (x, y, width, height). */
data class ArtPiece(
    val viewBox: List<Double>,
    val layers: List<ArtLayer>,
    /** Loops on the whole picture (a floating illustration). */
    val loops: List<String> = emptyList(),
)
