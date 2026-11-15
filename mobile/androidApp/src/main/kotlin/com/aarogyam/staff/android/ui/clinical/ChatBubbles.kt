package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.team.AttachmentView
import com.aarogyam.staff.team.MessageView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

private val bubbleShape = RoundedCornerShape(18.dp)

/** One message: text, a notice card or a file; mine on the right, a failed one tappable to retry. */
@Composable
fun ChatBubble(
    message: MessageView,
    thumbLink: String?,
    onRetry: () -> Unit,
    onOpen: (String) -> Unit,
    onThumb: (String) -> Unit,
) {
    val colors = SkTheme.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (message.mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier.fillMaxWidth(BUBBLE_WIDTH),
            horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            val author = message.author
            if (!message.mine &&
                author != null
            ) {
                Text(author, style = SkTypography.caption, color = colors.textMuted.color)
            }
            Column(
                Modifier.alpha(if (message.pending) 0.6f else 1f),
                horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start,
            ) {
                BubbleContent(message, thumbLink, onOpen, onThumb)
            }
            when {
                message.failed -> {
                    Text(
                        stringResource(R.string.cn_c_chat_failed),
                        style = SkTypography.label,
                        color = colors.dangerText.color,
                        modifier =
                            Modifier
                                .heightIn(
                                    min = Spacing.MIN_TOUCH_TARGET.dp,
                                ).clickable(role = Role.Button, onClick = onRetry),
                    )
                }

                message.pending -> {
                    Text(
                        stringResource(R.string.cn_c_chat_sending),
                        style = SkTypography.caption,
                        color = colors.textMuted.color,
                    )
                }

                message.at.isNotEmpty() -> {
                    Text(
                        ClinicalFormat.chatTime(message.at),
                        style = SkTypography.caption,
                        color = colors.textMuted.color,
                    )
                }
            }
        }
    }
}

private const val BUBBLE_WIDTH = 0.82f

@Composable
private fun BubbleContent(
    message: MessageView,
    thumbLink: String?,
    onOpen: (String) -> Unit,
    onThumb: (String) -> Unit,
) {
    if (message.deleted) {
        TextCard(stringResource(R.string.cn_c_chat_deleted), message.mine, italic = true)
        return
    }
    val file = message.attachment
    if (file != null) AttachmentCard(file, thumbLink, onOpen, onThumb)
    val body = message.body
    if (!body.isNullOrEmpty()) {
        if (message.notice) NoticeCard(body) else TextCard(body, message.mine, italic = false)
    }
}

@Composable
private fun TextCard(
    text: String,
    mine: Boolean,
    italic: Boolean,
) {
    val colors = SkTheme.colors
    Text(
        text,
        style = SkTypography.bodyText,
        fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
        color = (if (mine) colors.onPrimary else colors.text).color,
        modifier =
            Modifier
                .padding(vertical = 2.dp)
                .background((if (mine) colors.primary else colors.card).color, bubbleShape)
                .padding(horizontal = 13.dp, vertical = 9.dp),
    )
}

/** A notice: the tinted card with a "Notice" kicker, apart from ordinary bubbles. */
@Composable
private fun NoticeCard(text: String) {
    val colors = SkTheme.colors
    Column(
        Modifier
            .padding(vertical = 2.dp)
            .background(colors.warningSoft.color, bubbleShape)
            .padding(horizontal = 13.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            stringResource(R.string.cn_c11_notice).uppercase(),
            style = SkTypography.overline,
            color = colors.warningText.color,
        )
        Text(text, style = SkTypography.bodyText, color = colors.warningText.color)
    }
}

@Composable
private fun AttachmentCard(
    file: AttachmentView,
    thumbLink: String?,
    onOpen: (String) -> Unit,
    onThumb: (String) -> Unit,
) {
    val colors = SkTheme.colors
    if (file.image) {
        val photo = stringResource(R.string.cn_c11_photo_a11y)
        LaunchedEffect(file.id) { if (file.id.isNotEmpty() && thumbLink == null) onThumb(file.id) }
        val bitmap by rememberChatBitmap(thumbLink, file.id.ifEmpty { null }, THUMB_EDGE)
        Box(
            Modifier
                .padding(vertical = 2.dp)
                .size(200.dp, 150.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(colors.inset.color)
                .then(if (file.id.isEmpty()) Modifier else Modifier.clickable(role = Role.Button) { onOpen(file.id) })
                .semantics { contentDescription = photo },
            contentAlignment = Alignment.Center,
        ) {
            bitmap?.let {
                Image(
                    it.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize(),
                )
            }
        }
    } else {
        Column(
            Modifier
                .padding(vertical = 2.dp)
                .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                .background(colors.card.color, RoundedCornerShape(16.dp))
                .clickable(role = Role.Button) { onOpen(file.id) }
                .padding(horizontal = 12.dp, vertical = 9.dp),
        ) {
            Text(
                file.fileName ?: stringResource(R.string.cn_c11_file_a11y),
                style = SkTypography.bodyStrong,
                color = colors.text.color,
                maxLines = 1,
            )
            Text(ClinicalFormat.sizeLabel(file.sizeBytes), style = SkTypography.caption, color = colors.textMuted.color)
        }
    }
}

private const val THUMB_EDGE = 600
