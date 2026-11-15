package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.patient.openPatient
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.desk.DeskBoardStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The waiting-room board on its own screen (opened from Schedule), reloaded while it shows. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeskBoardScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
) {
    val feed = rememberHolder { DeskFeed(clinic, it) }
    val board = rememberHolder<DeskBoardStateHolder> { DeskBoardStateHolder(clinic, it) }
    val feedState by feed.state.collectAsStateWithLifecycle()
    val boardState by board.state.collectAsStateWithLifecycle()
    val online by graph.connectivity.online.collectAsStateWithLifecycle()
    var refreshing by remember { mutableStateOf(false) }
    var paying by remember { mutableStateOf<DeskPayTarget?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            feed.refresh()
            launch {
                graph.live.changes().collect {
                    board.refresh()
                    feed.refresh()
                }
            }
        }
    }
    LaunchedEffect(refreshing) {
        if (refreshing) {
            delay(REFRESH_MILLIS)
            refreshing = false
        }
    }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = stringResource(R.string.dk_d9_board_title),
            actions = {
                BarAction(
                    stringResource(R.string.dk_d9_done),
                    SkTheme.colors.onBrandDark.color,
                    nav::popBackStack,
                )
            },
        )
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                board.refresh()
                feed.refresh()
            },
            modifier = Modifier.weight(1f),
        ) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Spacing.ML.dp)) {
                DeskBoardContent(
                    board,
                    boardState,
                    DeskBoardContext(
                        roleKey = clinic.session.membership.roleKey,
                        permissions = clinic.permissions,
                        feed = feedState,
                        remind = feed::remind,
                        online = online,
                        onOpenPatient = nav::openPatient,
                        onCollect = { paying = it },
                    ),
                )
            }
        }
    }
    paying?.let { target ->
        DeskPaymentSheet(graph, clinic, target, feedState.version) {
            paying = null
            board.refresh()
            feed.refresh()
        }
    }
}

private const val REFRESH_MILLIS = 800L
