package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.team.ChatListStateHolder
import com.aarogyam.staff.team.ConversationRow
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay

private const val LIST_POLL_MS = 60_000L

/** The team chat list: the Everyone channel first, then groups and direct chats, with unread counts. Refreshed every minute while open. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    holder: ChatListStateHolder,
    onBack: () -> Unit,
    onOpen: (id: String, title: String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val owner = LocalLifecycleOwner.current
    LaunchedEffect(holder) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(LIST_POLL_MS)
                holder.refresh()
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = stringResource(R.string.cn_c_chat_title),
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
        )
        PullToRefreshBox(
            isRefreshing = state.loading && state.rows.isNotEmpty(),
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f),
        ) {
            val error = state.error
            when {
                !state.allowed -> {
                    SkEmptyState(
                        stringResource(R.string.cn_c_chat_not_allowed_title),
                        stringResource(R.string.cn_c_chat_not_allowed_message),
                    )
                }

                error != null && state.rows.isEmpty() -> {
                    SkEmptyState(
                        stringResource(R.string.cn_c_chat_title),
                        stringResource(error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                state.loading && state.rows.isEmpty() -> {
                    LoadingIndicator()
                }

                state.rows.isEmpty() -> {
                    SkEmptyState(
                        stringResource(R.string.cn_c_chat_empty_title),
                        stringResource(R.string.cn_c_chat_empty_message),
                    )
                }

                else -> {
                    LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(Spacing.ML.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) { items(state.rows, key = { it.id }) { ConversationItem(it) { onOpen(it.id, it.title) } } }
                }
            }
        }
    }
}

@Composable
private fun ConversationItem(
    row: ConversationRow,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    val unreadText =
        if (row.unread >
            0
        ) {
            stringResource(R.string.cn_c_chat_unread_a11y, row.title, row.unread)
        } else {
            row.title
        }
    Box(
        Modifier
            .clip(RoundedCornerShape(16.dp))
            .background(colors.card.color)
            .clearAndSetSemantics { contentDescription = unreadText },
    ) {
        SkListRow(
            title = row.title,
            subtitle =
                if (row.lastMessageAt !=
                    null
                ) {
                    ClinicalFormat.chatTime(row.lastMessageAt!!)
                } else {
                    stringResource(R.string.cn_c_chat_no_messages)
                },
            onClick = onClick,
            leading = { SkAvatar(row.title, tone = if (row.channel) SkTone.Brand else SkTone.Info, size = 38.dp) },
            trailing = {
                if (row.unread > 0) {
                    Text(
                        row.unread.toString(),
                        style = SkTypography.chip,
                        color = colors.onPrimary.color,
                        modifier =
                            Modifier
                                .heightIn(min = 22.dp)
                                .background(colors.primary.color, RoundedCornerShape(11.dp))
                                .padding(horizontal = 7.dp),
                    )
                }
            },
        )
    }
}
