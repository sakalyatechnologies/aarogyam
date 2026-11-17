package com.aarogyam.staff.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

/**
 * Light status bar icons while a dark brand header is on screen, dark ones over a light page. Screens
 * overlap while navigating, so headers are counted rather than switched.
 */
object StatusBarTone {
    private val darkHeaders = mutableIntStateOf(0)

    /** Marks a dark brand header (the top bar, the visit header) as on screen while it is composed. */
    @Composable
    fun DarkHeader() {
        DisposableEffect(Unit) {
            darkHeaders.intValue++
            onDispose { darkHeaders.intValue-- }
        }
    }

    /**
     * Inside a full-screen dialog over a light page (Chair mode): the dialog has its own window, so
     * its status bar icons are set here, dark over the page and light in dark mode.
     */
    @Composable
    fun DialogLightPage() {
        val view = LocalView.current
        val dark = isSystemInDarkTheme()
        LaunchedEffect(dark) {
            val window = (view.parent as? DialogWindowProvider)?.window ?: return@LaunchedEffect
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !dark
        }
    }

    /** Applies the tone to the window; call once, at the root. */
    @Composable
    fun Apply() {
        val view = LocalView.current
        val lightIcons = darkHeaders.intValue > 0 || isSystemInDarkTheme()
        LaunchedEffect(lightIcons) {
            val window = (view.context as? Activity)?.window ?: return@LaunchedEffect
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !lightIcons
        }
    }
}
