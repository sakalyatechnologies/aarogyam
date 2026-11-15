package com.aarogyam.staff.android.ui.clinical

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.team.AttachmentLink
import com.aarogyam.staff.team.ChatThreadStateHolder
import com.aarogyam.staff.team.MessageView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay

private const val THREAD_POLL_MS = 4_000L
private const val FULL_EDGE = 2048

/** One conversation: the pinned notice, bubbles (mine on the right), a composer. Polls every few seconds while in front. */
@Composable
fun ChatThreadScreen(
    holder: ChatThreadStateHolder,
    title: String,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    val context = LocalContext.current
    val list = rememberLazyListState()
    LaunchedEffect(holder) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(THREAD_POLL_MS)
                holder.poll()
            }
        }
    }
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) list.animateScrollToItem(state.messages.lastIndex)
    }
    LaunchedEffect(state.link) {
        // A file (not a picture) goes to the system; the link is never kept.
        val link = state.link ?: return@LaunchedEffect
        if (link.image) return@LaunchedEffect
        val target = ClinicalFormat.openable(link.url)
        try {
            if (target !=
                null
            ) {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, target.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        } catch (_: ActivityNotFoundException) {
            // No app can show it; the person sees nothing more to do.
        }
        holder.closeLink()
    }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(title = title, navigation = {
            BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack)
        })
        state.pinned?.let { PinnedNotice(it) }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val error = state.error
            when {
                state.loading && state.messages.isEmpty() -> {
                    LoadingIndicator()
                }

                error != null && state.messages.isEmpty() -> {
                    SkEmptyState(stringResource(R.string.cn_c_chat_title), stringResource(error.message()))
                }

                state.messages.isEmpty() -> {
                    Text(
                        stringResource(R.string.cn_c_chat_thread_empty),
                        style = SkTypography.bodyText,
                        color = SkTheme.colors.textMuted.color,
                        modifier = Modifier.align(Alignment.Center),
                    )
                }

                else -> {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        state = list,
                        contentPadding = PaddingValues(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(state.messages, key = { it.clientId }) { message ->
                            ChatBubble(
                                message,
                                thumbLink = message.attachment?.let { state.thumbs[it.id] },
                                onRetry = { holder.retry(message.clientId) },
                                onOpen = holder::openAttachment,
                                onThumb = holder::requestThumb,
                            )
                        }
                    }
                }
            }
        }
        ChatComposer(holder, state)
    }
    state.link?.takeIf { it.image }?.let { ImageViewer(it, holder::closeLink) }
    if (state.linkFailed) NoticeDialog(R.string.cn_c11_file_open_failed, holder::closeLink)
}

/** The newest notice, above the messages. */
@Composable
private fun PinnedNotice(message: MessageView) {
    val colors = SkTheme.colors
    val label = stringResource(R.string.cn_c11_pinned_a11y)
    Column(
        Modifier
            .fillMaxWidth()
            .background(colors.warningSoft.color)
            .padding(horizontal = Spacing.L.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = label + ", " + message.body.orEmpty() },
    ) {
        message.author?.let { Text(it, style = SkTypography.caption, color = colors.warningText.color) }
        Text(message.body.orEmpty(), style = SkTypography.bodyStrong, color = colors.warningText.color, maxLines = 3)
    }
}

/** A picture shown full screen. */
@Composable
private fun ImageViewer(
    link: AttachmentLink,
    onClose: () -> Unit,
) {
    val bitmap: Bitmap? by rememberChatBitmap(link.url, key = null, edge = FULL_EDGE)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            bitmap?.let {
                Image(
                    it.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
                ?: LoadingIndicator()
            Box(Modifier.align(Alignment.TopEnd).padding(Spacing.M.dp)) {
                BarAction(stringResource(R.string.cn_c11_close), Color.White, onClose)
            }
        }
    }
}
