package com.aarogyam.staff.android.ui.chart

import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.ToothKind
import com.aarogyam.staff.chart.ToothView

/** The paints a tooth needs, resolved from the theme once per composition. */
class ToothPaints(
    val whole: Pair<Finding, FindingPaint>?,
    val surfaces: Map<Surface, FindingPaint>,
    val pending: Boolean,
) {
    companion object {
        @Composable
        fun from(tooth: ToothView): ToothPaints =
            ToothPaints(
                whole = tooth.whole?.takeIf { it != Finding.Sound }?.let { it to it.paint() },
                surfaces =
                    Surface.entries
                        .mapNotNull { s -> tooth.finding(s)?.takeIf { it != Finding.Sound }?.let { s to it.paint() } }
                        .toMap(),
                pending = tooth.pending,
            )
    }
}

/**
 * Where a tooth's parts sit in a `w` by `h` box. Upper teeth have the root at the top, lower teeth
 * at the bottom, so both crowns face the biting plane. The buccal zone is on the root side and the
 * lingual zone on the biting side; mesial faces the midline.
 */
class ToothGeometry(
    private val tooth: ToothView,
    w: Float,
    h: Float,
) {
    private val rootH = h * ROOT_SHARE
    val crown: Rect = if (tooth.upper) Rect(0f, rootH, w, h) else Rect(0f, 0f, w, h - rootH)
    val root: Rect =
        if (tooth.upper) {
            Rect(w * ROOT_INSET, 0f, w * (1 - ROOT_INSET), rootH)
        } else {
            Rect(
                w * ROOT_INSET,
                h - rootH,
                w * (1 - ROOT_INSET),
                h,
            )
        }
    private val ix = crown.width * INNER
    private val iy = crown.height * INNER
    val inner = Rect(crown.left + ix, crown.top + iy, crown.right - ix, crown.bottom - iy)
    private val rootSide = if (tooth.upper) Side.Top else Side.Bottom

    private enum class Side { Top, Bottom, Left, Right }

    private fun sideOf(surface: Surface): Side? =
        when (surface) {
            Surface.O -> null
            Surface.B -> rootSide
            Surface.L -> if (rootSide == Side.Top) Side.Bottom else Side.Top
            Surface.M -> if (tooth.mesialFacesRight) Side.Right else Side.Left
            Surface.D -> if (tooth.mesialFacesRight) Side.Left else Side.Right
        }

    /** The zone of [surface] inside the crown. */
    fun zone(surface: Surface): Path {
        val c = crown
        val i = inner
        val points =
            when (sideOf(surface)) {
                null -> listOf(i.topLeft, i.topRight, i.bottomRight, i.bottomLeft)
                Side.Top -> listOf(c.topLeft, c.topRight, i.topRight, i.topLeft)
                Side.Bottom -> listOf(c.bottomLeft, c.bottomRight, i.bottomRight, i.bottomLeft)
                Side.Left -> listOf(c.topLeft, i.topLeft, i.bottomLeft, c.bottomLeft)
                Side.Right -> listOf(c.topRight, i.topRight, i.bottomRight, c.bottomRight)
            }
        return Path().apply {
            moveTo(points[0].x, points[0].y)
            points.drop(1).forEach { lineTo(it.x, it.y) }
            close()
        }
    }

    /** The crown outline: rounded, with a pointed cusp for canines. */
    fun crownPath(): Path =
        Path().apply {
            val r = crown.width * if (tooth.kind == ToothKind.Molar || tooth.kind == ToothKind.Premolar) 0.28f else 0.2f
            addRoundRect(RoundRect(crown, CornerRadius(r, r)))
        }

    /** The root silhouette, two roots for molars, tapering away from the crown. */
    fun rootPath(): Path {
        val r = root
        val base = if (tooth.upper) r.bottom else r.top
        val tip = if (tooth.upper) r.top else r.bottom
        val mid = (base + tip) / 2
        return Path().apply {
            moveTo(r.left, base)
            if (tooth.kind == ToothKind.Molar) {
                quadraticTo(r.left, tip, r.left + r.width * 0.22f, tip)
                quadraticTo(r.left + r.width * 0.4f, mid, r.center.x, mid)
                quadraticTo(r.right - r.width * 0.4f, mid, r.right - r.width * 0.22f, tip)
                quadraticTo(r.right, tip, r.right, base)
            } else {
                quadraticTo(r.left + r.width * 0.1f, tip, r.center.x, tip)
                quadraticTo(r.right - r.width * 0.1f, tip, r.right, base)
            }
            close()
        }
    }

    /** The surface under [at], or null outside the crown (the whole tooth). */
    fun surfaceAt(at: Offset): Surface? {
        if (!crown.contains(at)) return null
        if (inner.contains(at)) return Surface.O
        val distances =
            mapOf(
                Side.Top to (at.y - crown.top) / crown.height,
                Side.Bottom to (crown.bottom - at.y) / crown.height,
                Side.Left to (at.x - crown.left) / crown.width,
                Side.Right to (crown.right - at.x) / crown.width,
            )
        val side = distances.minBy { it.value }.key
        return Surface.entries.first { sideOf(it) == side }
    }

    private companion object {
        const val ROOT_SHARE = 0.42f
        const val ROOT_INSET = 0.14f
        const val INNER = 0.28f
    }
}

/** Draws one tooth: root, crown, surface findings, whole-tooth marks and the selection. */
fun DrawScope.drawTooth(
    g: ToothGeometry,
    paints: ToothPaints,
    outline: Color,
    highlight: Color,
    selected: Boolean,
    selectedSurface: Surface?,
) {
    val whole = paints.whole
    val alpha = if (paints.pending) PENDING_ALPHA else 1f
    val thin = Stroke(width = 1.dp.toPx())
    if (whole?.first == Finding.Missing) {
        val dashed =
            Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx())))
        drawPath(g.rootPath(), whole.second.ink, alpha = MISSING_ALPHA * alpha, style = dashed)
        drawPath(g.crownPath(), whole.second.ink, alpha = MISSING_ALPHA * alpha, style = dashed)
        if (selected) drawPath(g.crownPath(), highlight, style = Stroke(width = 2.dp.toPx()))
        return
    }
    val root = g.rootPath()
    drawPath(
        root,
        if (whole?.first ==
            Finding.Implant
        ) {
            whole.second.fill
        } else {
            outline.copy(alpha = ROOT_TINT)
        },
        alpha = alpha,
    )
    drawPath(root, outline, alpha = alpha, style = thin)
    when (whole?.first) {
        Finding.RootCanal -> {
            val r = g.root
            drawLine(
                whole.second.ink,
                Offset(r.center.x, r.top + r.height * 0.15f),
                Offset(
                    r.center.x,
                    r.bottom - r.height * 0.15f,
                ),
                2.dp.toPx(),
                alpha = alpha,
            )
        }

        Finding.Implant -> {
            val r = g.root
            for (k in 1..SCREW_THREADS) {
                val y = r.top + r.height * k / (SCREW_THREADS + 1)
                drawLine(
                    whole.second.ink,
                    Offset(r.left + r.width * 0.2f, y),
                    Offset(r.right - r.width * 0.2f, y),
                    1.dp.toPx(),
                    alpha = alpha,
                )
            }
        }

        else -> {}
    }
    val crown = g.crownPath()
    clipPath(crown) {
        if (whole != null) drawRect(whole.second.fill, g.crown.topLeft, g.crown.size, alpha = alpha)
        paints.surfaces.forEach { (surface, paint) ->
            val zone = g.zone(surface)
            clipPath(zone) {
                drawRect(paint.fill, g.crown.topLeft, g.crown.size, alpha = alpha)
                drawPattern(paint, g.crown, alpha)
            }
        }
        if (whole != null) drawPattern(whole.second, g.crown, alpha)
        Surface.entries.forEach { drawPath(g.zone(it), outline, alpha = alpha, style = thin) }
        selectedSurface?.let { drawPath(g.zone(it), highlight, style = Stroke(width = 2.dp.toPx())) }
    }
    val heavy = whole?.first == Finding.Crown
    drawPath(
        crown,
        if (heavy) whole.second.ink else outline,
        alpha = alpha,
        style = Stroke(width = if (heavy) 2.dp.toPx() else 1.dp.toPx()),
    )
    if (selected) drawPath(crown, highlight, style = Stroke(width = 2.5f.dp.toPx()))
}

private fun DrawScope.drawPattern(
    paint: FindingPaint,
    box: Rect,
    alpha: Float,
) {
    val step = 3.dp.toPx()
    val ink = paint.ink
    when (paint.pattern) {
        Pattern.None, Pattern.Solid -> {}

        Pattern.Stripes, Pattern.Cross -> {
            var x = box.left - box.height
            while (x < box.right) {
                drawLine(ink, Offset(x, box.bottom), Offset(x + box.height, box.top), 0.8f.dp.toPx(), alpha = alpha)
                if (paint.pattern ==
                    Pattern.Cross
                ) {
                    drawLine(
                        ink,
                        Offset(x, box.top),
                        Offset(x + box.height, box.bottom),
                        0.8f.dp.toPx(),
                        alpha = alpha,
                    )
                }
                x += step
            }
        }

        Pattern.Vertical, Pattern.Grid -> {
            var x = box.left + step / 2
            while (x < box.right) {
                drawLine(ink, Offset(x, box.top), Offset(x, box.bottom), 0.8f.dp.toPx(), alpha = alpha)
                x += step
            }
            if (paint.pattern == Pattern.Grid) drawHorizontal(ink, box, step, alpha)
        }

        Pattern.Bars -> {
            drawHorizontal(ink, box, step * 2, alpha)
        }

        Pattern.Dots -> {
            var y = box.top + step / 2
            while (y < box.bottom) {
                var x = box.left + step / 2
                while (x < box.right) {
                    drawCircle(ink, 0.7f.dp.toPx(), Offset(x, y), alpha = alpha)
                    x += step
                }
                y += step
            }
        }
    }
}

private fun DrawScope.drawHorizontal(
    ink: Color,
    box: Rect,
    step: Float,
    alpha: Float,
) {
    var y = box.top + step / 2
    while (y < box.bottom) {
        drawLine(ink, Offset(box.left, y), Offset(box.right, y), 0.8f.dp.toPx(), alpha = alpha)
        y += step
    }
}

private const val PENDING_ALPHA = 0.55f
private const val MISSING_ALPHA = 0.6f
private const val ROOT_TINT = 0.35f
private const val SCREW_THREADS = 4

/** A legend swatch: the finding's fill and pattern in [box], outlined (dashed for missing). */
fun DrawScope.drawSwatch(
    paint: FindingPaint,
    box: Rect,
    outline: Color,
    dashed: Boolean,
) {
    drawRect(paint.fill, box.topLeft, box.size)
    clipRect(box.left, box.top, box.right, box.bottom) { drawPattern(paint, box, 1f) }
    val effect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx())) else null
    drawRect(outline, box.topLeft, box.size, style = Stroke(width = 1.dp.toPx(), pathEffect = effect))
}
