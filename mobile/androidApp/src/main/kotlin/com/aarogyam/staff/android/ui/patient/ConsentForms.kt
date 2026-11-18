package com.aarogyam.staff.android.ui.patient

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.consents.ConsentFormsHolder
import com.aarogyam.staff.consents.ConsentFormsState
import com.aarogyam.staff.consents.ConsentView
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/**
 * Under a given consent: "View signed form" when one is linked, else "Add signed form" (the camera,
 * or the photo picker where the phone has none) for a role that may write.
 */
@Composable
internal fun SignedFormLink(
    consent: ConsentView,
    forms: ConsentFormsHolder,
    state: ConsentFormsState,
    canAdd: Boolean,
) {
    val formId = consent.signedFormId
    when {
        formId != null -> FormLink(stringResource(R.string.p9_consent_form_view)) { forms.open(formId) }
        state.attaching == consent.id -> V7Muted(stringResource(R.string.p9_consent_form_adding))
        canAdd -> FormCamera(stringResource(R.string.p9_consent_form_add)) { forms.attach(consent.id, it) }
    }
}

/** Opens a fetched signed-form link with the system once; the link is not kept. */
@Composable
internal fun SignedFormEffect(
    forms: ConsentFormsHolder,
    state: ConsentFormsState,
) {
    val context = LocalContext.current
    LaunchedEffect(state.link) {
        val url = state.link ?: return@LaunchedEffect
        ClinicalFormat.openable(url)?.let { target ->
            try {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, target.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: ActivityNotFoundException) {
                // No app can show it.
            }
        }
        forms.close()
    }
}

@Composable
private fun FormCamera(
    label: String,
    onPhoto: (ByteArray) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val hasCamera = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    val target = remember { newCameraTarget(context) }
    val handle: (Uri) -> Unit = { uri -> scope.launch { resizeToJpeg(context, uri)?.let(onPhoto) } }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) handle(target.second) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(handle) }
    FormLink(label) {
        if (hasCamera) {
            take.launch(target.second)
        } else {
            pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
    }
}

@Composable
private fun FormLink(
    label: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier.defaultMinSize(minHeight = 36.dp).clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(label, style = v7(12.5f, FontWeight.Bold), color = SkTheme.palette.primary.color)
    }
}
