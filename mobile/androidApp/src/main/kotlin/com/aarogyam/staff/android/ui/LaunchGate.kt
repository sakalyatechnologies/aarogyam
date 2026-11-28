package com.aarogyam.staff.android.ui

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Ink = Color(0xFF0F172A)
private val Teal = Color(0xFF5EEAD4)

// The splash drawable (ic_launcher_foreground) places the 100-unit mark inside a 108 dp box at this offset and scale.
private const val ORIGIN = 20.952f
private const val SCALE = 0.66096f
private const val MIN_MS = 1200L
private const val MIN_STILL_MS = 400L

/** True when the person turned animations off (Developer options "remove animations", or the same in accessibility). */
@Composable
private fun animationsOff(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/**
 * Shows the branded launch over [content] until the app is ready, then lifts it away while the content fades in.
 * It plays once per launch; [content] gets `launching = true` while it is up, so it can skip its own spinner.
 */
@Composable
fun LaunchGate(
    waiting: Boolean,
    content: @Composable (launching: Boolean) -> Unit,
) {
    var done by rememberSaveable { mutableStateOf(false) }
    val still = animationsOff()
    val exit = remember { Animatable(0f) }
    val start = remember { System.nanoTime() }
    LaunchedEffect(waiting) {
        if (waiting || done) return@LaunchedEffect
        // Hold a fast restore just long enough for the mark to rise and the wordmark to land (1.2 s).
        val rest = (if (still) MIN_STILL_MS else MIN_MS) - (System.nanoTime() - start) / 1_000_000
        if (rest > 0) delay(rest)
        exit.animateTo(1f, tween(if (still) 150 else 350, easing = FastOutSlowInEasing))
        done = true
    }
    Box(Modifier.fillMaxSize().background(Ink)) {
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                val p = if (done) 1f else exit.value
                alpha = p
                if (!still) {
                    scaleX = 0.98f + 0.02f * p
                    scaleY = scaleX
                }
            },
        ) { content(!done) }
        if (!done) LaunchMark(exit.value, still)
    }
}

@Composable
private fun LaunchMark(
    out: Float,
    still: Boolean,
) {
    // The mark starts exactly as the system splash left it, rises, then a highlight sweeps the bar.
    val rise = remember { Animatable(0f) }
    val word = remember { Animatable(if (still) 1f else 0f) }
    val shine = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        if (still) return@LaunchedEffect
        launch { rise.animateTo(1f, spring(dampingRatio = 0.75f, stiffness = Spring.StiffnessLow)) }
        delay(150)
        launch { word.animateTo(1f, tween(400, easing = FastOutSlowInEasing)) }
        delay(250)
        shine.animateTo(1.3f, tween(450, easing = FastOutSlowInEasing))
    }
    val pulse = rememberInfiniteTransition(label = "launch")
    val glow by pulse.animateFloat(
        0.1f,
        0.6f,
        infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Reverse),
        label = "glow",
    )
    Box(
        Modifier.fillMaxSize().graphicsLayer {
            alpha = 1f - out
            if (!still) {
                scaleX = 1f + 0.08f * out
                scaleY = scaleX
            }
        },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(108.dp).graphicsLayer { translationY = -28.dp.toPx() * rise.value }) {
            drawMark(shine.value, if (word.value >= 1f) glow else 0f)
        }
        Column(
            Modifier.offset(y = 70.dp).alpha(word.value),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                "Aarogyam",
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.graphicsLayer { translationY = (1f - word.value) * 8.dp.toPx() },
            )
            Dots()
        }
    }
}

/** Three small dots that rise and fall in turn: progress without a spinner. */
@Composable
private fun Dots() {
    val t = rememberInfiniteTransition(label = "dots")
    val phase by t.animateFloat(0f, 3f, infiniteRepeatable(tween(1800, easing = LinearEasing)), label = "phase")
    Canvas(Modifier.size(24.dp, 4.dp)) {
        for (i in 0..2) {
            val d = ((phase - i) % 3f + 3f) % 3f
            val a = if (d < 1f) 1f - 0.75f * d else 0.25f
            drawCircle(
                Color.White.copy(alpha = a * 0.7f),
                2.dp.toPx(),
                Offset(
                    2.dp.toPx() + i * 10.dp.toPx(),
                    size.height / 2,
                ),
            )
        }
    }
}

private fun DrawScope.drawMark(
    shine: Float,
    glow: Float,
) {
    val u = size.width / 108f

    fun pt(
        x: Float,
        y: Float,
    ) = Offset((ORIGIN + SCALE * x) * u, (ORIGIN + SCALE * y) * u)
    val path =
        Path().apply {
            moveTo(pt(22f, 82f).x, pt(22f, 82f).y)
            lineTo(pt(50f, 18f).x, pt(50f, 18f).y)
            lineTo(pt(78f, 82f).x, pt(78f, 82f).y)
        }
    drawPath(path, Color.White, style = Stroke(10f * SCALE * u, cap = StrokeCap.Round, join = StrokeJoin.Round))
    val from = pt(34f, 60f)
    val to = pt(66f, 60f)
    if (glow > 0f) drawLine(Teal.copy(alpha = glow), from, to, 20f * SCALE * u, StrokeCap.Round)
    drawLine(Teal, from, to, 8f * SCALE * u, StrokeCap.Round)
    if (shine > 0f && shine < 1.3f) {
        val head = shine.coerceAtMost(1f)
        val tail = (shine - 0.3f).coerceIn(0f, 1f)
        drawLine(
            Color.White.copy(alpha = 0.9f),
            pt(34f + 32f * tail, 60f),
            pt(34f + 32f * head, 60f),
            8f * SCALE * u,
            StrokeCap.Round,
        )
    }
}
