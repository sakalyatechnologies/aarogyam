package com.aarogyam.patient.android.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import com.aarogyam.patient.android.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

private const val MAX_SIDE = 2048
private const val MAX_ZOOM = 6f

/** An image from the cache, drawn to fit; pinch to zoom, drag to move. */
@Composable
fun ZoomableImage(path: String) {
    val bitmap by produceState<Bitmap?>(null, path) { value = withContext(Dispatchers.IO) { decode(path) } }
    val shown = bitmap
    if (shown == null) {
        LoadingIndicator()
        return
    }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
                    offset = if (scale == 1f) Offset.Zero else offset + pan
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Image(
            shown.asImageBitmap(),
            contentDescription = stringResource(R.string.file_image_description),
            contentScale = ContentScale.Fit,
            modifier =
                Modifier.fillMaxSize().graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                ),
        )
    }
}

/** Reads the image downsampled so its longest side is about [MAX_SIDE] pixels. */
private fun decode(path: String): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** A PDF from the cache, one page after another, rendered at the screen's width. */
@Composable
fun PdfPages(path: String) {
    val renderer =
        remember(path) {
            runCatching { PdfRenderer(ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY)) }
                .getOrNull()
        }
    DisposableEffect(renderer) { onDispose { renderer?.close() } }
    if (renderer == null) {
        BodyText(stringResource(R.string.error_unknown))
        return
    }
    val lock = remember(renderer) { Mutex() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val widthPx = with(LocalDensity.current) { maxWidth.roundToPx() }
        LazyColumn(Modifier.fillMaxSize()) {
            items((0 until renderer.pageCount).toList(), key = { it }) { index ->
                PdfPage(renderer, lock, index, widthPx)
            }
        }
    }
}

@Composable
private fun PdfPage(
    renderer: PdfRenderer,
    lock: Mutex,
    index: Int,
    widthPx: Int,
) {
    val page by produceState<Bitmap?>(null, index, widthPx) {
        value = lock.withLock { withContext(Dispatchers.IO) { render(renderer, index, widthPx) } }
    }
    val shown = page
    if (shown == null) {
        Box(Modifier.fillMaxWidth().height(240.dp))
    } else {
        Image(
            shown.asImageBitmap(),
            contentDescription = stringResource(R.string.file_page_description, index + 1),
            modifier = Modifier.fillMaxWidth(),
            contentScale = ContentScale.FillWidth,
        )
    }
}

/** One page on a white background, [widthPx] wide. */
private fun render(
    renderer: PdfRenderer,
    index: Int,
    widthPx: Int,
): Bitmap {
    val page = renderer.openPage(index)
    try {
        val height = (widthPx.toLong() * page.height / page.width).toInt().coerceAtLeast(1)
        val bitmap = createBitmap(widthPx, height)
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        return bitmap
    } finally {
        page.close()
    }
}
