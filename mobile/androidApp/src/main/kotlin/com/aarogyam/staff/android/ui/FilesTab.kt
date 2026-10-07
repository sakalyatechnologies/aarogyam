package com.aarogyam.staff.android.ui

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.files.FileView
import com.aarogyam.staff.files.FilesState
import com.aarogyam.staff.files.FilesStateHolder
import com.aarogyam.staff.files.LabelGroup
import com.aarogyam.staff.files.PRESET_LABELS
import com.aarogyam.staff.files.UploadProblem
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/** The Files tab of Patient 360: the gallery grouped by label, and (with `clinical.write`) take or pick a photo. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesTab(holder: FilesStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    PullToRefreshBox(
        isRefreshing = (state as? FilesState.Loaded)?.refreshing == true,
        onRefresh = holder::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        when (val current = state) {
            FilesState.Loading -> {
                LoadingIndicator()
            }

            FilesState.NotAllowed -> {
                SkEmptyState(stringResource(R.string.patient_tab_files), stringResource(R.string.files_not_allowed))
            }

            is FilesState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.patient_tab_files),
                    stringResource(current.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::refresh,
                )
            }

            is FilesState.Loaded -> {
                Gallery(current, holder)
            }
        }
    }
}

@Composable
private fun Gallery(
    state: FilesState.Loaded,
    holder: FilesStateHolder,
) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        if (state.canUpload) item { AddPhoto(state.uploading) { picked = it } }
        state.error?.let { item { Problem(stringResource(it.message())) } }
        state.problem?.let { item { Problem(stringResource(it.message())) } }
        if (state.groups.isEmpty()) {
            item {
                SkEmptyState(
                    stringResource(R.string.files_empty_title),
                    stringResource(R.string.files_empty_message),
                )
            }
        }
        items(state.groups, key = { it.label ?: "" }) { group -> Group(group, holder) }
    }
    picked?.let { uri ->
        LabelDialog(
            onCancel = { picked = null },
            onSend = { label, tooth, resized ->
                picked = null
                holder.upload(resized, label, tooth)
            },
            uri = uri,
            onProblem = { picked = null },
        )
    }
}

@Composable
private fun Problem(text: String) {
    Text(text, style = SkTypography.footnote, color = SkTheme.colors.dangerText.color)
}

@Composable
private fun UploadProblem.message(): Int =
    when (this) {
        UploadProblem.LabelTooLong -> R.string.files_problem_label
        UploadProblem.BadTooth -> R.string.files_problem_tooth
        UploadProblem.TooLarge -> R.string.files_problem_large
        UploadProblem.Failed -> R.string.files_problem_failed
    }

/** The camera uses the system camera app and the gallery the system photo picker: neither needs a permission. */
@Composable
private fun AddPhoto(
    uploading: Boolean,
    onPicked: (Uri) -> Unit,
) {
    val context = LocalContext.current
    val camera = remember { newCameraTarget(context) }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) onPicked(camera.second) }
    val choose =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri !=
                null
            ) {
                onPicked(uri)
            }
        }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        SkButton(
            stringResource(if (uploading) R.string.files_uploading else R.string.files_take_photo),
            onClick = { take.launch(camera.second) },
            enabled = !uploading,
            modifier = Modifier.weight(1f),
        )
        SkButton(
            stringResource(R.string.files_choose_photo),
            onClick = { choose.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            enabled = !uploading,
            variant = SkButtonVariant.Secondary,
            modifier = Modifier.weight(1f),
        )
    }
}

/** Asks for the label and tooth, shrinks the photo on the phone, then hands the JPEG over. */
@Composable
private fun LabelDialog(
    uri: Uri,
    onCancel: () -> Unit,
    onProblem: () -> Unit,
    onSend: (label: String?, tooth: Int?, jpeg: ByteArray) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var preset by remember { mutableStateOf<String?>(null) }
    var custom by remember { mutableStateOf("") }
    var toothText by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var unreadable by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(R.string.files_label_title)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
            ) {
                PRESET_LABELS.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                        row.forEach { label ->
                            FilterChip(
                                selected = preset == label,
                                onClick = {
                                    preset = if (preset == label) null else label
                                    custom = ""
                                },
                                label = { Text(label) },
                            )
                        }
                    }
                }
                OutlinedTextField(
                    value = custom,
                    onValueChange = {
                        custom = it
                        if (it.isNotBlank()) preset = null
                    },
                    label = { Text(stringResource(R.string.files_label_custom)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = toothText,
                    onValueChange = { toothText = it.filter(Char::isDigit).take(2) },
                    label = { Text(stringResource(R.string.files_tooth_field)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (unreadable) Problem(stringResource(R.string.files_problem_read))
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    busy = true
                    scope.launch {
                        val jpeg = resizeToJpeg(context, uri)
                        deleteCameraCopy(context)
                        if (jpeg == null) {
                            unreadable = true
                            busy = false
                        } else {
                            onSend(preset ?: custom.ifBlank { null }, toothText.toIntOrNull(), jpeg)
                        }
                    }
                },
            ) { Text(stringResource(R.string.files_send)) }
        },
        dismissButton = {
            TextButton(onClick = {
                deleteCameraCopy(context)
                onCancel()
            }) { Text(stringResource(R.string.files_cancel)) }
        },
    )
}

private fun deleteCameraCopy(context: android.content.Context) {
    runCatching { java.io.File(context.cacheDir, "photos/capture.jpg").delete() }
}

@Composable
private fun Group(
    group: LabelGroup,
    holder: FilesStateHolder,
) {
    SkCard {
        Text(
            group.label ?: stringResource(R.string.files_unlabelled),
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
        )
        Column(Modifier.padding(top = Spacing.SM.dp), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            group.files.chunked(COLUMNS).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                    row.forEach { file -> Thumb(file, holder, Modifier.weight(1f)) }
                    repeat(COLUMNS - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun Thumb(
    file: FileView,
    holder: FilesStateHolder,
    modifier: Modifier,
) {
    val bitmap by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, file.id) {
        if (file.isImage) {
            value = holder.preview(file.id)?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }
        }
    }
    Column(modifier) {
        Box(Modifier.fillMaxWidth().size(THUMB.dp)) {
            bitmap?.let {
                Image(
                    it,
                    contentDescription = file.label,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
                ?: Text(
                    stringResource(R.string.files_not_image),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.textMuted.color,
                )
        }
        file.tooth?.let {
            Text(
                stringResource(R.string.files_tooth, it),
                style = SkTypography.footnote,
                color = SkTheme.colors.textMuted.color,
            )
        }
    }
}

private const val COLUMNS = 3
private const val THUMB = 96
