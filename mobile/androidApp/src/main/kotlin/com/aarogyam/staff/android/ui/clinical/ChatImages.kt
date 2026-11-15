package com.aarogyam.staff.android.ui.clinical

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** Downloads chat pictures from their short-lived links; the picture is kept (by file id), the link never is. */
object ChatImages {
    private const val MAX_BYTES = 12 * 1024 * 1024
    private const val TIMEOUT_MS = 15_000
    private val cache = LruCache<String, Bitmap>(24)

    fun cached(key: String): Bitmap? = cache.get(key)

    /** The picture at [link] shrunk to about [edge] pixels on its long side; null when it can't be fetched. */
    suspend fun load(
        link: String,
        key: String?,
        edge: Int,
    ): Bitmap? {
        key?.let { cache.get(it) }?.let { return it }
        val target = ClinicalFormat.openable(link) ?: return null
        val bitmap =
            withContext(Dispatchers.IO) {
                runCatching {
                    val connection = URL(target).openConnection() as HttpURLConnection
                    connection.connectTimeout = TIMEOUT_MS
                    connection.readTimeout = TIMEOUT_MS
                    val bytes =
                        try {
                            connection.inputStream.use { readCapped(it) }
                        } finally {
                            connection.disconnect()
                        }
                    decode(bytes, edge)
                }.getOrNull()
            }
        if (bitmap != null && key != null) cache.put(key, bitmap)
        return bitmap
    }

    private fun readCapped(input: java.io.InputStream): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (out.size() < MAX_BYTES) {
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }

    private fun decode(
        bytes: ByteArray,
        edge: Int,
    ): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= edge) sample *= 2
        return BitmapFactory.decodeByteArray(
            bytes,
            0,
            bytes.size,
            BitmapFactory.Options().apply { inSampleSize = sample },
        )
    }
}

/** The picture for [link] (null while the link is still being asked for), cached under [key] when given. */
@Composable
fun rememberChatBitmap(
    link: String?,
    key: String?,
    edge: Int,
): State<Bitmap?> =
    produceState(initialValue = key?.let(ChatImages::cached), link, key) {
        if (value == null && link != null) value = ChatImages.load(link, key, edge)
    }
