package com.aarogyam.staff.android.ui.art

import androidx.compose.foundation.Canvas
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.semantics.clearAndSetSemantics
import com.aarogyam.staff.art.ArtColor
import com.aarogyam.staff.art.ArtLayer
import com.aarogyam.staff.art.ArtPaint
import com.aarogyam.staff.art.ArtPiece
import com.aarogyam.staff.art.ArtStop
import com.aarogyam.staff.art.pathData
import com.sakalya.mobile.design.HexColor
import com.sakalya.mobile.design.Loop
import com.sakalya.mobile.design.LoopFrame
import com.sakalya.mobile.design.Loops
import com.sakalya.mobile.design.PathCommand
import com.sakalya.mobile.design.PathData
import com.sakalya.mobile.design.Pivot
import com.sakalya.mobile.design.ViewBox
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.rememberLoopClock
import com.sakalya.mobile.designcompose.toComposePath

/** A loop as the mockup names it, with its start offset. */
private fun loopOf(kind: String): Pair<Loop, Int>? =
    when (kind) {
        "bob" -> Loops.BOB to 0
        "blink" -> Loops.BLINK to 0
        "glow" -> Loops.GLOW to 0
        "float" -> Loops.FLOAT to 0
        "rock" -> Loops.ROCK to 0
        "twinkle" -> Loops.TWINKLE to 0
        "twinkle2" -> Loops.TWINKLE to Loops.TWINKLE_OFFSET_MS
        else -> null
    }

/** One prepared layer: its path in view-box units and the bounds used for gradients. */
private class Prepared(
    val layer: ArtLayer,
    val path: PathData,
    val bounds: Rect,
)

/**
 * Draws a layered v7 picture (avatar or illustration), fitted and centred, with its gradients,
 * theme colours (the clinic's brand) and its loops (blink, bob, float...), still under reduced
 * motion. Decorative: give the surrounding element the description.
 */
@Composable
fun ArtImage(
    piece: ArtPiece,
    modifier: Modifier = Modifier,
) {
    val palette = SkTheme.palette.toMap()
    val current = LocalContentColor.current
    val prepared =
        remember(piece) {
            piece.layers.mapNotNull { l ->
                l.pathData()?.let { Prepared(l, it, it.bounds()) }
            }
        }
    val nodes = remember(prepared) { nodeBounds(prepared) }
    val time by rememberLoopClock()
    val box = ViewBox(piece.viewBox[0], piece.viewBox[1], piece.viewBox[2], piece.viewBox[3])
    Canvas(modifier.clearAndSetSemantics {}) {
        val fit = box.fit(size.width.toDouble(), size.height.toDouble())
        val s = fit.scale.toFloat()

        fun px(r: Rect) =
            Rect(
                r.left * s + fit.dx.toFloat(),
                r.top * s + fit.dy.toFloat(),
                r.right * s + fit.dx.toFloat(),
                r.bottom * s + fit.dy.toFloat(),
            )
        val whole = piece.loops.firstNotNullOfOrNull { loopOf(it) }
        loopTransform(
            whole?.let { (l, o) ->
                l.sample((time + o).toDouble())
            },
            whole?.first?.pivot,
            Rect(Offset.Zero, size),
            s,
        ) {
            for (p in prepared) {
                val path = p.path.toComposePath(box, Size(size.width, size.height))
                val frames =
                    p.layer.loops.mapNotNull { a ->
                        loopOf(a.kind)?.let { (l, o) ->
                            Triple(
                                l,
                                l.sample(
                                    (
                                        time +
                                            o
                                    ).toDouble(),
                                ),
                                nodes[a.node],
                            )
                        }
                    }
                nested(frames, 0, ::px, s) {
                    val alpha = (p.layer.opacity * frames.fold(1.0) { acc, f -> acc * f.second.alpha }).toFloat()
                    brush(p.layer.fill, px(p.bounds), s, fit, palette, current)?.let { drawPath(path, it, alpha, Fill) }
                    brush(p.layer.stroke, px(p.bounds), s, fit, palette, current)?.let {
                        val stroke =
                            Stroke(
                                (p.layer.strokeWidth * s).toFloat(),
                                cap = if (p.layer.roundCaps) StrokeCap.Round else StrokeCap.Butt,
                                join = if (p.layer.roundJoins) StrokeJoin.Round else StrokeJoin.Miter,
                            )
                        drawPath(path, it, alpha, stroke)
                    }
                }
            }
        }
    }
}

/** Applies [frames] from the outermost loop inwards, then draws. */
private fun DrawScope.nested(
    frames: List<Triple<Loop, LoopFrame, Rect?>>,
    from: Int,
    px: (Rect) -> Rect,
    scale: Float,
    draw: DrawScope.() -> Unit,
) {
    // Layers list loops innermost first; the outermost transform applies first.
    val i = frames.size - 1 - from
    if (i < 0) return draw()
    val (loop, frame, node) = frames[i]
    loopTransform(frame, loop.pivot, node?.let(px), scale) { nested(frames, from + 1, px, scale, draw) }
}

private fun DrawScope.loopTransform(
    frame: LoopFrame?,
    pivot: Pivot?,
    box: Rect?,
    scale: Float,
    draw: DrawScope.() -> Unit,
) {
    if (frame == null || box == null || frame == LoopFrame.REST) return draw()
    val origin =
        when (pivot) {
            Pivot.Top -> Offset(box.center.x, box.top)
            Pivot.Bottom -> Offset(box.center.x, box.bottom)
            else -> box.center
        }
    withTransform({
        translate((frame.dx * scale).toFloat(), (frame.dy * scale).toFloat())
        rotate(frame.rotation.toFloat(), origin)
        scale(frame.scaleX.toFloat(), frame.scaleY.toFloat(), origin)
    }) { draw() }
}

private fun brush(
    paint: ArtPaint,
    bounds: Rect,
    scale: Float,
    fit: ViewBox.Fit,
    palette: Map<String, HexColor>,
    current: Color,
): Brush? {
    fun color(c: ArtColor): Color =
        when (c) {
            ArtColor.Current -> {
                current
            }

            is ArtColor.Role -> {
                palette[c.name]?.color ?: current
            }

            is ArtColor.Fixed -> {
                HexColor
                    .parse(c.hex)
                    ?.color
                    ?.copy(alpha = c.alpha.toFloat())
                    ?: Color.Transparent
            }
        }

    fun stops(s: List<ArtStop>) =
        s
            .map {
                it.offset.toFloat() to
                    color(it.color).copy(alpha = color(it.color).alpha * it.opacity.toFloat())
            }.toTypedArray()

    fun at(
        x: Double,
        y: Double,
        box: Boolean,
    ) = if (box) {
        Offset(bounds.left + bounds.width * x.toFloat(), bounds.top + bounds.height * y.toFloat())
    } else {
        Offset((x * scale + fit.dx).toFloat(), (y * scale + fit.dy).toFloat())
    }
    return when (paint) {
        ArtPaint.None -> {
            null
        }

        is ArtPaint.Solid -> {
            androidx.compose.ui.graphics
                .SolidColor(color(paint.color))
        }

        is ArtPaint.Linear -> {
            Brush.linearGradient(
                *stops(paint.stops),
                start = at(paint.x1, paint.y1, paint.boxUnits),
                end = at(paint.x2, paint.y2, paint.boxUnits),
            )
        }

        is ArtPaint.Radial -> {
            val r =
                if (paint.boxUnits) {
                    (paint.r * (bounds.width + bounds.height) / 2).toFloat()
                } else {
                    (paint.r * scale)
                        .toFloat()
                }
            Brush.radialGradient(
                *stops(paint.stops),
                center = at(paint.cx, paint.cy, paint.boxUnits),
                radius = r.coerceAtLeast(1f),
            )
        }
    }
}

/** The union of each loop node's layer bounds, in view-box units. */
private fun nodeBounds(layers: List<Prepared>): Map<Int, Rect> {
    val out = mutableMapOf<Int, Rect>()
    for (p in layers) for (l in p.layer.loops) out[l.node] = out[l.node]?.let { union(it, p.bounds) } ?: p.bounds
    return out
}

private fun union(
    a: Rect,
    b: Rect,
) = Rect(minOf(a.left, b.left), minOf(a.top, b.top), maxOf(a.right, b.right), maxOf(a.bottom, b.bottom))

/** The bounds of a path's points (control points included; close enough for pivots and gradients). */
private fun PathData.bounds(): Rect {
    val xs = mutableListOf<Double>()
    val ys = mutableListOf<Double>()
    for (c in commands) {
        when (c) {
            is PathCommand.MoveTo -> {
                xs += c.x
                ys += c.y
            }

            is PathCommand.LineTo -> {
                xs += c.x
                ys += c.y
            }

            is PathCommand.CubicTo -> {
                xs += listOf(c.x1, c.x2, c.x)
                ys +=
                    listOf(c.y1, c.y2, c.y)
            }

            PathCommand.Close -> {}
        }
    }
    if (xs.isEmpty()) return Rect.Zero
    return Rect(xs.min().toFloat(), ys.min().toFloat(), xs.max().toFloat(), ys.max().toFloat())
}
