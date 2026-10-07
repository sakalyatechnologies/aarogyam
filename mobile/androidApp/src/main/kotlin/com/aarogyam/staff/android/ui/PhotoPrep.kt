package com.aarogyam.staff.android.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.aarogyam.staff.files.PhotoLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/** The cache file the camera app writes to, and the content address it is shared under. */
fun newCameraTarget(context: Context): Pair<File, Uri> {
    val folder = File(context.cacheDir, "photos").apply { mkdirs() }
    val file = File(folder, "capture.jpg")
    return file to FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
}

/**
 * Reads the photo at [uri], turns it upright, shrinks it to [PhotoLimits.MAX_EDGE] and re-encodes
 * it as a JPEG at [PhotoLimits.JPEG_QUALITY]. Re-encoding drops the EXIF block, so the location
 * and device details never leave the phone. Null when the picture can't be read.
 */
suspend fun resizeToJpeg(
    context: Context,
    uri: Uri,
): ByteArray? =
    withContext(Dispatchers.Default) {
        runCatching {
            val resolver = context.contentResolver
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null
            val (width, height) = PhotoLimits.fit(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= width) sample *= 2
            val decoded =
                resolver.openInputStream(uri)?.use {
                    BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
                } ?: return@runCatching null
            val turn =
                resolver.openInputStream(uri)?.use { stream ->
                    when (
                        ExifInterface(
                            stream,
                        ).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                    ) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                        else -> 0f
                    }
                } ?: 0f
            val longest = maxOf(decoded.width, decoded.height)
            val scale = if (longest > PhotoLimits.MAX_EDGE) PhotoLimits.MAX_EDGE.toFloat() / longest else 1f
            val matrix = Matrix().apply { postRotate(turn) }
            matrix.postScale(scale, scale)
            val final = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            val out = ByteArrayOutputStream()
            final.compress(Bitmap.CompressFormat.JPEG, PhotoLimits.JPEG_QUALITY, out)
            out.toByteArray()
        }.getOrNull()
    }
