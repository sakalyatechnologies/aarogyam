package com.aarogyam.staff.android.ui.tasks

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate

/** A short burst of coloured pieces, about 1.5 seconds (iOS `ConfettiBurst`); the caller skips it under reduced motion. */
@Composable
fun Confetti(burst: Int) {
    val progress = remember(burst) { Animatable(0f) }
    LaunchedEffect(burst) { progress.animateTo(1f, tween(DURATION_MS, easing = FastOutSlowInEasing)) }
    Canvas(Modifier.fillMaxSize()) {
        val t = progress.value
        if (t >= 1f) return@Canvas
        val origin = Offset(size.width / 2, size.height * ORIGIN_Y)
        for (i in 0 until PIECES) {
            val dx = ((i * 37) % 200 - 100) * 1.6f
            val dy = ((i * 53) % 260 + 80).toFloat()
            val spin = (i * 40 + 360).toFloat()
            val hue = (i % 7) * (360f / 7)
            val at = Offset(origin.x + dx * t * density, origin.y + (-20f + (dy + 20f) * t) * density)
            rotate(spin * t, at) {
                drawRect(
                    Color.hsv(hue, 0.7f, 0.95f, 1f - t),
                    topLeft = Offset(at.x - PIECE_W * density / 2, at.y - PIECE_H * density / 2),
                    size = Size(PIECE_W * density, PIECE_H * density),
                )
            }
        }
    }
}

private const val DURATION_MS = 1500
private const val PIECES = 28
private const val PIECE_W = 8f
private const val PIECE_H = 12f
private const val ORIGIN_Y = 0.2f
