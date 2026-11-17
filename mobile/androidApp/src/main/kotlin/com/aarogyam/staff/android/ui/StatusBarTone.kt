package com.aarogyam.staff.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.platform.LocalView
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
