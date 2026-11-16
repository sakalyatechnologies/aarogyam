package com.aarogyam.staff.android.ui.clinical

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.team.ChatThreadStateHolder
import com.aarogyam.staff.team.ThreadState
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/** The message box: attach a photo (the text becomes its caption), the text, send, and with `chat.notice` a "Post as notice" switch. */
@Composable
fun ChatComposer(
    holder: ChatThreadStateHolder,
    state: ThreadState,
) {
    val colors = SkTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var choosing by remember { mutableStateOf(false) }
    var unreadable by remember { mutableStateOf(false) }
    val camera = remember { newCameraTarget(context) }

    fun send(uri: Uri) {
        scope.launch {
            val jpeg = resizeToJpeg(context, uri)
            if (jpeg == null) unreadable = true else holder.sendPhoto(jpeg)
        }
    }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) send(camera.second) }
    val choose =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri !=
                null
            ) {
                send(uri)
            }
        }

    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.background.color)
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = Spacing.L.dp, vertical = Spacing.SM.dp),
    ) {
        if (state.canNotice) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = Spacing.MIN_TOUCH_TARGET.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    stringResource(R.string.cn_c11_notice_toggle),
                    style = SkTypography.label,
                    color = colors.text.color,
                )
                Switch(checked = state.notice, onCheckedChange = holder::setNotice)
            }
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            RoundButton("+", stringResource(R.string.cn_c11_attach), colors.inset.color, colors.textMuted.color) {
                choosing =
                    true
            }
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(colors.inset.color)
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                val hint = stringResource(R.string.cn_c_chat_compose)
                if (state.draft.isEmpty()) Text(hint, style = SkTypography.bodyText, color = colors.textMuted.color)
                BasicTextField(
                    value = state.draft,
                    onValueChange = holder::setDraft,
                    textStyle = SkTypography.bodyText.copy(color = colors.text.color),
                    cursorBrush = SolidColor(colors.primary.color),
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = hint },
                )
            }
            val empty = state.draft.isBlank()
            RoundButton(
                "↑",
                stringResource(R.string.cn_c_chat_send),
                if (empty) colors.inset.color else colors.primary.color,
                if (empty) colors.textMuted.color else colors.onPrimary.color,
                enabled = !empty,
                onClick = holder::send,
            )
        }
    }
    if (choosing) {
        AlertDialog(
            onDismissRequest = { choosing = false },
            title = { Text(stringResource(R.string.cn_c11_attach)) },
            text = {
                Column {
                    TextButton(onClick = {
                        choosing = false
                        take.launch(camera.second)
                    }) { Text(stringResource(R.string.cn_c11_photo_camera)) }
                    TextButton(onClick = {
                        choosing = false
                        choose.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }) { Text(stringResource(R.string.cn_c11_photo_library)) }
                }
            },
            confirmButton = {},
        )
    }
    if (state.refused) NoticeDialog(R.string.cn_c11_photo_refused, holder::dismissRefused)
    if (unreadable) NoticeDialog(R.string.cn_c11_photo_unreadable) { unreadable = false }
}

@Composable
internal fun NoticeDialog(
    message: Int,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(message)) },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cn_c11_ok)) } },
    )
}

@Composable
private fun RoundButton(
    glyph: String,
    description: String,
    background: androidx.compose.ui.graphics.Color,
    content: androidx.compose.ui.graphics.Color,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(Spacing.MIN_TOUCH_TARGET.dp)
            .clip(CircleShape)
            .background(background)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(glyph, style = SkTypography.headline, color = content) }
}
