package com.aarogyam.staff.android.ui.tasks

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/**
 * A small camera button on an open task: takes a photo (the photo picker where the phone has no camera) and hands back
 * the shrunken JPEG. The photo never reaches disk beyond the camera's own cache file. The system camera app takes
 * the photo, so the app declares no CAMERA permission (declaring it would make that intent need it).
 */
@Composable
fun TaskProofButton(onPhoto: (ByteArray) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val hasCamera =
        remember { context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA_ANY) }
    val target = remember { newCameraTarget(context) }
    val handle: (Uri) -> Unit = { uri -> scope.launch { resizeToJpeg(context, uri)?.let(onPhoto) } }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) handle(target.second) }
    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri !=
                null
            ) {
                handle(uri)
            }
        }
    val label = stringResource(R.string.sh_tasks10_proof)
    val p = SkTheme.palette
    Box(
        Modifier
            .sizeIn(minWidth = Spacing.MIN_TOUCH_TARGET.dp, minHeight = Spacing.MIN_TOUCH_TARGET.dp)
            .background(p.primaryContainer.color, CircleShape)
            .clickable(role = Role.Button) {
                if (hasCamera) {
                    take.launch(target.second)
                } else {
                    pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
            }.semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        SkIcon(Icons.of("cam"), p.onPrimaryContainer.color, size = 20.dp)
    }
}
