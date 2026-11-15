package com.aarogyam.staff.android.ui.desk

import android.graphics.Bitmap
import android.graphics.Paint
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import com.sakalya.mobile.design.Radii
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Path as AndroidPath

/**
 * A white pad to sign on with a finger. Reports the PNG (null when empty) after each stroke; [clearToken] changes
 * to wipe it. The signature is patient data: it goes to the holder and nowhere else.
 */
@Composable
fun IntakeSignaturePad(
    clearToken: Int,
    description: String,
    onChange: (ByteArray?) -> Unit,
) {
    val strokes = remember { mutableStateListOf<List<Offset>>() }
    var live by remember { mutableStateOf<List<Offset>>(emptyList()) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(clearToken) {
        if (strokes.isNotEmpty()) {
            strokes.clear()
            live = emptyList()
            onChange(null)
        }
    }
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(PAD_HEIGHT.dp)
            .clip(RoundedCornerShape(Radii.M.dp))
            .background(Color.White)
            .onSizeChanged { size = it }
            .semantics { contentDescription = description }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { live = listOf(it) },
                    onDragEnd = {
                        strokes.add(live)
                        live = emptyList()
                        val snapshot = strokes.toList()
                        scope.launch { onChange(signaturePng(snapshot, size)) }
                    },
                    onDragCancel = { live = emptyList() },
                ) { change, _ ->
                    change.consume()
                    live = live + change.position
                }
            },
    ) {
        val style = Stroke(width = INK_DP.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        (strokes + listOf(live)).forEach { drawPath(pathOf(it), Color.Black, style = style) }
    }
}

private fun pathOf(points: List<Offset>): Path =
    Path().apply {
        points.firstOrNull()?.let { moveTo(it.x, it.y) }
        points.drop(1).forEach { lineTo(it.x, it.y) }
        if (points.size == 1) points.first().let { lineTo(it.x + 0.1f, it.y) }
    }

/** The strokes as PNG bytes on a white ground; null when nothing was drawn. */
suspend fun signaturePng(
    strokes: List<List<Offset>>,
    size: IntSize,
): ByteArray? =
    withContext(Dispatchers.Default) {
        if (strokes.isEmpty() || size.width <= 0 || size.height <= 0) return@withContext null
        val bitmap = createBitmap(size.width, size.height)
        val canvas = AndroidCanvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)
        val paint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.BLACK
                style = Paint.Style.STROKE
                strokeWidth = INK_PX
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
            }
        strokes.forEach { points ->
            val path = AndroidPath()
            points.firstOrNull()?.let { path.moveTo(it.x, it.y) }
            points.drop(1).forEach { path.lineTo(it.x, it.y) }
            if (points.size == 1) points.first().let { path.lineTo(it.x + 0.1f, it.y) }
            canvas.drawPath(path, paint)
        }
        ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, PNG_QUALITY, out)
            out.toByteArray()
        }
    }

private const val PAD_HEIGHT = 160
private const val INK_DP = 3
private const val INK_PX = 6f
private const val PNG_QUALITY = 100
