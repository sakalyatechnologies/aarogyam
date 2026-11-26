package com.aarogyam.staff.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The brand mark (brand/aarogyam-mark.svg geometry) on the header's soft tile. The A takes the theme's
 * on-surface colour and the crossbar its primary, so the logo follows the clinic theme and dark mode.
 */
@Composable
internal fun BrandGlyph(
    size: Int,
    modifier: Modifier = Modifier,
) {
    val ink = SkTheme.palette.onSurface.color
    val accent = SkTheme.palette.primary.color
    Canvas(
        modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size * TILE_RADIUS).dp))
            .background(SkTheme.palette.surface2.color),
    ) {
        stroke(ink, A_WEIGHT) {
            moveTo(x(A_LEFT), y(A_BASE))
            lineTo(x(A_TOP_X), y(A_TOP))
            lineTo(x(A_RIGHT), y(A_BASE))
        }
        stroke(accent, BAR_WEIGHT) {
            moveTo(x(BAR_LEFT), y(BAR_Y))
            lineTo(x(BAR_RIGHT), y(BAR_Y))
        }
    }
}

private fun DrawScope.x(v: Float) = size.width * (INSET + v * SCALE / 100f)

private fun DrawScope.y(v: Float) = size.height * (INSET + v * SCALE / 100f)

private fun DrawScope.stroke(
    color: Color,
    weight: Float,
    build: Path.() -> Unit,
) = drawPath(
    Path().apply(build),
    color,
    style = Stroke(weight * SCALE * size.width / 100f, cap = StrokeCap.Round, join = StrokeJoin.Round),
)

private const val TILE_RADIUS = 0.29f
private const val INSET = 0.14f
private const val SCALE = 0.72f
private const val A_WEIGHT = 10f
private const val BAR_WEIGHT = 8f
private const val A_LEFT = 22f
private const val A_RIGHT = 78f
private const val A_TOP_X = 50f
private const val A_TOP = 18f
private const val A_BASE = 82f
private const val BAR_LEFT = 34f
private const val BAR_RIGHT = 66f
private const val BAR_Y = 60f
