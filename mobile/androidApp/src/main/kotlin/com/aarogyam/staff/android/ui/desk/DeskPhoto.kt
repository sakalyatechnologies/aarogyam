package com.aarogyam.staff.android.ui.desk

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import kotlinx.coroutines.launch

/** Words for one [DeskPhotoPicker]. */
data class DeskPhotoLabels(
    val camera: String,
    val library: String,
    val remove: String,
    val preview: String,
)

/**
 * Take a photo with the camera app or choose one with the system picker (neither needs a permission). The photo is
 * shrunk on the phone and handed over as a JPEG; [photo] shows a preview with a Remove button.
 */
@Composable
fun DeskPhotoPicker(
    photo: ByteArray?,
    labels: DeskPhotoLabels,
    onPhoto: (ByteArray?) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val camera = remember { newCameraTarget(context) }
    val take =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { done ->
            if (done) scope.launch { resizeToJpeg(context, camera.second)?.let(onPhoto) }
        }
    val choose =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) scope.launch { resizeToJpeg(context, uri)?.let(onPhoto) }
        }
    if (photo != null) {
        val bitmap = remember(photo) { BitmapFactory.decodeByteArray(photo, 0, photo.size)?.asImageBitmap() }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (bitmap != null) {
                Image(
                    bitmap,
                    labels.preview,
                    Modifier.size(PREVIEW.dp).clip(RoundedCornerShape(Spacing.SM.dp)),
                    contentScale = ContentScale.Crop,
                )
            }
            SkButton(labels.remove, onClick = { onPhoto(null) }, variant = SkButtonVariant.Secondary)
        }
    } else {
        DeskWrap {
            SkButton(labels.camera, onClick = { take.launch(camera.second) }, variant = SkButtonVariant.Secondary)
            SkButton(
                labels.library,
                onClick = { choose.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                variant = SkButtonVariant.Secondary,
            )
        }
    }
}

private const val PREVIEW = 84
