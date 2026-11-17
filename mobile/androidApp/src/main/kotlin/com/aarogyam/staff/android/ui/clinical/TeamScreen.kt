package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.team.InviteStaffStateHolder
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.MemberRow
import com.aarogyam.staff.team.PendingInviteRow
import com.aarogyam.staff.team.TeamStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.CoroutineScope

/** The team list (`staff.manage`): who is in the clinic, their role and whether they are active; a tap opens a direct chat when the role may chat. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamScreen(
    holder: TeamStateHolder,
    canChat: Boolean,
    /** Makes the invite sheet's holder; null when the role may not invite. */
    invite: ((CoroutineScope) -> InviteStaffStateHolder)?,
    onBack: () -> Unit,
    onChats: () -> Unit,
    onOpenChat: (id: String, title: String) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val opened by holder.opened.collectAsStateWithLifecycle()
    val pending by holder.pending.collectAsStateWithLifecycle()
    var inviting by remember { mutableStateOf(false) }
    var chattingWith by remember { mutableStateOf("") }
    val direct = stringResource(R.string.cn_c_chat_direct)
    LaunchedEffect(opened) {
        val id = opened ?: return@LaunchedEffect
        holder.consumeOpened()
        onOpenChat(id, chattingWith.ifEmpty { direct })
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            SkTopBar(
                title = stringResource(R.string.cn_c_team_title),
                navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
                actions = {
                    if (invite != null) {
                        BarAction(stringResource(R.string.cn_c_team_invite), SkTheme.colors.onBrandDark.color, {
                            inviting =
                                true
                        })
                    }
                },
            )
            PullToRefreshBox(isRefreshing = false, onRefresh = holder::refresh, modifier = Modifier.weight(1f)) {
                when (val current = state) {
                    ListState.Loading -> {
                        LoadingIndicator()
                    }

                    ListState.NotAllowed -> {
                        SkEmptyState(
                            stringResource(R.string.cn_c_team_not_allowed_title),
                            stringResource(R.string.cn_c_team_not_allowed_message),
                        )
                    }

                    is ListState.Failed -> {
                        SkEmptyState(
                            stringResource(R.string.cn_c_team_title),
                            stringResource(current.error.message()),
                            actionLabel = stringResource(R.string.try_again),
                            onAction = holder::refresh,
                        )
                    }

                    is ListState.Loaded -> {
                        LazyColumn(
                            Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(Spacing.ML.dp),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            if (canChat) item { ChatsRow(onChats) }
                            items(current.items, key = { it.membershipId }) { row ->
                                MemberItem(row, canChat && !row.me) {
                                    chattingWith = row.name
                                    holder.message(row.membershipId)
                                }
                            }
                            if (pending.isNotEmpty()) {
                                item {
                                    Text(
                                        stringResource(R.string.cn_c_team_pending),
                                        style = SkTypography.label,
                                        color = SkTheme.palette.onSurfaceVariant.color,
                                        modifier = Modifier.padding(top = Spacing.L.dp, bottom = Spacing.XS.dp),
                                    )
                                }
                                items(pending, key = { it.id }) { PendingItem(it) }
                            }
                        }
                    }
                }
            }
        }
    }
    if (inviting && invite != null) {
        val inviter = rememberHolder { invite(it) }
        InviteSheet(inviter) {
            inviting = false
            if (inviter.state.value.sentTo != null) holder.refresh()
            inviter.another()
        }
    }
}

@Composable
private fun PendingItem(row: PendingInviteRow) {
    val until = row.expires?.date?.display()
    Box(Modifier.clip(RoundedCornerShape(16.dp)).background(SkTheme.colors.card.color)) {
        SkListRow(
            title = row.email ?: stringResource(R.string.cn_c_team_pending_no_email),
            subtitle =
                until?.let {
                    stringResource(
                        R.string.cn_c_team_pending_until,
                        row.roleName,
                        it,
                    )
                } ?: row.roleName,
            leading = { SkAvatar(row.email ?: "?", tone = SkTone.Neutral, size = 38.dp) },
        )
    }
}

@Composable
private fun ChatsRow(onClick: () -> Unit) {
    Box(Modifier.clip(RoundedCornerShape(20.dp)).background(SkTheme.colors.card.color)) {
        SkListRow(stringResource(R.string.cn_c_chat_open), onClick = onClick)
    }
}

@Composable
private fun MemberItem(
    row: MemberRow,
    chat: Boolean,
    onClick: () -> Unit,
) {
    Box(Modifier.clip(RoundedCornerShape(16.dp)).background(SkTheme.colors.card.color)) {
        SkListRow(
            title = row.name,
            subtitle = row.roleName,
            onClick = if (chat) onClick else null,
            leading = { SkAvatar(row.name, tone = if (row.active) SkTone.Brand else SkTone.Neutral, size = 38.dp) },
            trailing = {
                if (row.me) {
                    SkChip(stringResource(R.string.cn_c_team_you), tone = SkTone.Brand)
                } else if (!row.active) {
                    SkChip(stringResource(R.string.cn_c_team_inactive), tone = SkTone.Neutral)
                }
            },
        )
    }
}
