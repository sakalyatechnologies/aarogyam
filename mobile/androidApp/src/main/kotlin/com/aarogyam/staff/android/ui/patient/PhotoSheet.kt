package com.aarogyam.staff.android.ui.patient

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.Queued
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch
import java.util.UUID

/** What an added picture is saved as; [apiLabel] is what the clinic's files list shows (and what picks the kind). */
internal enum class PatientPhotoLabel(
    val apiLabel: String,
) {
    Opg("OPG"),
    Xray("X-ray"),
    Photo("Photo"),
    OldRx("Old Rx"),
    Report("Report"),
}

/**
 * The patient page's Photo action: pick a label, then the camera or the photo picker. The picture is
 * saved to the outbox at once (protected storage) and sent from there; the outbox badge shows while it waits.
 * The camera uses the system camera app and the picker the system photo picker: neither needs a permission.
 */
@Composable
internal fun PhotoSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    /** The label picked to start with (OPG right after Start visit). */
    initial: PatientPhotoLabel = PatientPhotoLabel.Photo,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var label by remember { mutableStateOf(initial) }
    var problem by remember { mutableStateOf<Int?>(null) }
    val camera = remember { newCameraTarget(context) }
    val save = { uri: Uri ->
        scope.launch {
            val jpeg = resizeToJpeg(context, uri)
            problem =
                when {
                    jpeg == null -> {
                        R.string.p9_photo_refused
                    }

                    graph.writes.photo(
                        clinic.slug,
                        patientId,
                        UUID.randomUUID().toString(),
                        jpeg,
                        label.apiLabel,
                        null,
                    ) is Queued.Refused -> {
                        R.string.p9_photo_refused
                    }

                    else -> {
                        null
                    }
                }
            runCatching { camera.first.delete() }
            if (problem == null) onDone()
        }
        Unit
    }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) save(camera.second) }
    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri !=
                null
            ) {
                save(uri)
            }
        }
    val labels = PatientPhotoLabel.entries
    val titles = labels.associateWith { it.title() }
    SkModalSheet(stringResource(R.string.p9_photo_title), onDismiss = onDone) {
        V7Label(stringResource(R.string.p9_photo_label))
        SkChoiceChips(labels, setOf(label), { label = it }, { titles.getValue(it) })
        problem?.let {
            Text(
                stringResource(it),
                style = v7(12.5f, FontWeight.SemiBold),
                color = SkTheme.palette.error.color,
            )
        }
        Flow(spacing = 8.dp) {
            SkPillButton(stringResource(R.string.p9_photo_camera), {
                take.launch(camera.second)
            }, variant = SkPillVariant.Tonal, icon = PatientIcons.of("cam"))
            SkPillButton(
                stringResource(R.string.p9_photo_library),
                { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                variant = SkPillVariant.Tonal,
            )
        }
    }
}

@Composable
private fun PatientPhotoLabel.title(): String =
    stringResource(
        when (this) {
            PatientPhotoLabel.Opg -> R.string.p9_photo_opg
            PatientPhotoLabel.Xray -> R.string.p9_photo_xray
            PatientPhotoLabel.Photo -> R.string.p9_photo_photo
            PatientPhotoLabel.OldRx -> R.string.p9_photo_old_rx
            PatientPhotoLabel.Report -> R.string.p9_photo_report
        },
    )
