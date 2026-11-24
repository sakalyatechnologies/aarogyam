package com.aarogyam.staff.android.ui.story

import android.webkit.WebView
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.story.PresentEvent
import com.aarogyam.staff.story.PresentState
import com.aarogyam.staff.story.PresentStateHolder
import com.aarogyam.staff.story.StoryBridge
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/**
 * Show patient (design §1.12): the visit's mouth view full screen, drawn by the story bundle
 * exactly as on the web. System Back goes "Back to all teeth" first, then closes; the page's
 * hold-to-exit closes too. [onAddDepth] opens a tooth's decay depth chips.
 */
@Composable
internal fun PresentScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    visitId: String,
    onAddDepth: (Int) -> Unit,
    onClose: () -> Unit,
) {
    val holder = rememberHolder<PresentStateHolder>(visitId) { graph.present(clinic, visitId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    val close by rememberUpdatedState(onClose)
    val addDepth by rememberUpdatedState(onAddDepth)
    var webView by remember { mutableStateOf<WebView?>(null) }
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val closedText = stringResource(R.string.vv_present_visit_closed)
    val dark = isSystemInDarkTheme()
    LaunchedEffect(dark) { holder.setDark(dark) }
    LaunchedEffect(webView) {
        val view = webView ?: return@LaunchedEffect
        holder.scripts.collect { view.evaluateJavascript(it, null) }
    }
    LaunchedEffect(holder) {
        holder.events.collect {
            when (it) {
                PresentEvent.Exit -> close()
                is PresentEvent.AddDepth -> addDepth(it.tooth)
                PresentEvent.VisitClosed -> scope.launch { snackbar.showSnackbar(closedText) }
            }
        }
    }
    DisposableEffect(Unit) { onDispose { webView?.destroy() } }
    val back = {
        val view = webView
        if (view == null || state != PresentState.Showing) {
            close()
        } else {
            view.evaluateJavascript(StoryBridge.BACK) { if (!StoryBridge.wentBack(it)) close() }
        }
    }
    val background = SkTheme.palette.background.color
    Dialog(
        onDismissRequest = back,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(background).systemBarsPadding()) {
            AndroidView(
                factory = { context ->
                    storyWebView(context, holder::onPageMessage).also {
                        it.setBackgroundColor(background.toArgb())
                        webView = it
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            when (val now = state) {
                PresentState.Showing -> Unit
                PresentState.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                is PresentState.Failed -> Notice(stringResource(R.string.vv_present_failed), holder::refresh, back)
                PresentState.Unsupported -> Notice(stringResource(R.string.vv_present_unsupported), null, back)
            }
            SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
        }
    }
}

@Composable
private fun Notice(
    text: String,
    onRetry: (() -> Unit)?,
    onClose: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(SkTheme.palette.background.color).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, textAlign = TextAlign.Center, color = SkTheme.palette.onSurface.color)
        if (onRetry != null) SkButton(stringResource(R.string.vv_present_retry), onRetry)
        SkButton(stringResource(R.string.vv_present_close), onClose)
    }
}
