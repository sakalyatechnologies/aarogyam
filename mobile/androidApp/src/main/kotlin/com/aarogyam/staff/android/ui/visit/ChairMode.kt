package com.aarogyam.staff.android.ui.visit

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.outbox.Queued
import com.aarogyam.staff.visit.VisitStateHolder
import com.aarogyam.staff.visit.VisitView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

private val upperTeeth = (18 downTo 11) + (21..28)
private val lowerTeeth = (48 downTo 41) + (31..38)

/** Full-screen, large targets for use at the chair: hands-free Dictate, a big Photo button and tooth chips. */
@Composable
internal fun ChairMode(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    holder: VisitStateHolder,
    view: VisitView,
    onClose: () -> Unit,
) {
    val colors = SkTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var language by remember { mutableStateOf(DictationLanguage.English) }
    var tooth by remember { mutableStateOf<Int?>(null) }
    var toast by remember { mutableStateOf<Int?>(null) }
    val listening = view.listening != null
    val start = rememberDictationStarter(holder)
    val camera = remember { newCameraTarget(context) }
    val currentTooth by rememberUpdatedState(tooth)
    val take =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { done ->
            if (!done) return@rememberLauncherForActivityResult
            scope.launch {
                val jpeg = resizeToJpeg(context, camera.second)
                if (jpeg == null) {
                    toast = R.string.vv_dv10_chair_photo_refused
                    return@launch
                }
                val id = UUID.randomUUID().toString()
                val saved = graph.writes.photo(clinic.slug, patientId, id, jpeg, PHOTO_LABEL, currentTooth)
                toast =
                    if (saved is Queued.Saved) {
                        R.string.vv_dv10_chair_photo_saved
                    } else {
                        R.string.vv_dv10_chair_photo_refused
                    }
            }
        }
    LaunchedEffect(Unit) {
        while (true) {
            delay(AUTOSAVE_MS)
            holder.saveNow()
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            holder.stopListening()
            scope.launch { withContext(NonCancellable) { holder.saveNow() } }
        }
    }
    val properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    Dialog(onDismissRequest = onClose, properties = properties) {
        StatusBarTone.DialogLightPage()
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.background.color)
                .systemBarsPadding()
                .padding(Spacing.L.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.L.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.vv_dv10_chair_title),
                    style = SkTypography.title,
                    color = colors.text.color,
                )
                SkButton(stringResource(R.string.vv_dv10_chair_done), onClick = {
                    if (listening) holder.stopListening()
                    onClose()
                })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                DictationLanguage.entries.forEach { option ->
                    VisitChip(option.chipLabel(), (view.listening ?: language) == option, !listening) {
                        language =
                            option
                    }
                }
            }
            val dictateLabel = if (listening) R.string.vv_dv10_chair_stop_a11y else R.string.vv_dv10_chair_dictate_a11y
            BigButton(
                stringResource(if (listening) R.string.vv_dv10_chair_stop else R.string.vv_dv10_chair_dictate),
                if (listening) "■" else "●",
                filled = true,
                description = stringResource(dictateLabel),
            ) { if (listening) holder.stopListening() else start(language) }
            if (listening) {
                val heard = view.liveText ?: stringResource(R.string.vv_dv10_chair_listening)
                Text(heard, style = SkTypography.callout, color = colors.textMuted.color)
            }
            val photoLabel = stringResource(R.string.vv_dv10_chair_photo_a11y)
            BigButton(stringResource(R.string.vv_dv10_chair_photo), "◎", filled = false, description = photoLabel) {
                take.launch(camera.second)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                Text(
                    stringResource(R.string.vv_dv10_chair_teeth),
                    style = SkTypography.label,
                    color = colors.textMuted.color,
                )
                listOf(upperTeeth, lowerTeeth).forEach { arch ->
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                    ) {
                        arch.forEach { number ->
                            Box52 {
                                VisitChip(number.toString(), tooth == number) {
                                    tooth = if (tooth == number) null else number
                                }
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                val shown = toast
                if (shown != null) {
                    Text(stringResource(shown), style = SkTypography.bodyStrong, color = colors.text.color)
                } else {
                    Spacer(Modifier)
                }
                Muted(stringResource(R.string.vv_dv10_chair_autosave))
            }
        }
    }
}

@Composable
private fun Box52(content: @Composable () -> Unit) {
    Column(Modifier.sizeIn(minHeight = CHIP.dp), verticalArrangement = Arrangement.Center) { content() }
}

@Composable
private fun BigButton(
    title: String,
    glyph: String,
    filled: Boolean,
    description: String,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    val ink = if (filled) colors.onPrimary.color else colors.primaryText.color
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = BIG.dp)
            .clip(RoundedCornerShape(BIG_RADIUS.dp))
            .background(if (filled) colors.primary.color else colors.brandSoft.color)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(glyph, style = SkTypography.largeTitle, color = ink)
        Text(title, style = SkTypography.title, color = ink, textAlign = TextAlign.Center, maxLines = 2)
    }
}

private const val PHOTO_LABEL = "Photo"
private const val AUTOSAVE_MS = 8000L
private const val CHIP = 52
private const val BIG = 130
private const val BIG_RADIUS = 28
