package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.queue.QueueState
import com.aarogyam.staff.queue.QueueStateHolder
import com.aarogyam.staff.queue.VisitOpened
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Today's waiting room: Seat, Done, Left, and Start visit for doctors. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QueueScreen(
    holder: QueueStateHolder,
    onWalkIn: () -> Unit,
    onOpenVisit: (VisitOpened) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(holder) { holder.opened.collect(onOpenVisit) }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = stringResource(R.string.queue_title),
            actions = { BarAction(stringResource(R.string.walk_in_add), SkTheme.colors.onBrandDark.color, onWalkIn) },
        )
        val loaded = state as? QueueState.Loaded
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f),
        ) {
            when (val current = state) {
                QueueState.Loading -> {
                    LoadingIndicator()
                }

                QueueState.NotAllowed -> {
                    SkEmptyState(
                        stringResource(R.string.queue_not_allowed_title),
                        stringResource(R.string.queue_not_allowed_message),
                    )
                }

                is QueueState.Failed -> {
                    SkEmptyState(
                        stringResource(R.string.queue_title),
                        stringResource(current.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is QueueState.Loaded -> {
                    QueueList(current, holder)
                }
            }
        }
    }
}

@Composable
private fun QueueList(
    state: QueueState.Loaded,
    holder: QueueStateHolder,
) {
    if (state.rows.isEmpty()) {
        SkEmptyState(stringResource(R.string.queue_empty_title), stringResource(R.string.queue_empty_message))
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        state.actionError?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.bodyText,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        if (state.waiting.isNotEmpty()) item { Label(R.string.queue_waiting) }
        items(state.waiting, key = { it.id }) { TokenCard(it, state, holder) }
        if (state.finished.isNotEmpty()) item { Label(R.string.queue_finished) }
        items(state.finished, key = { it.id }) { TokenCard(it, state, holder) }
    }
}
