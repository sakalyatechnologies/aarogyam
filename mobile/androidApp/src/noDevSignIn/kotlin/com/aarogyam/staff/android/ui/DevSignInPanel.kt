package com.aarogyam.staff.android.ui

import androidx.compose.runtime.Composable
import com.aarogyam.staff.AppGraph

/**
 * Demo and prod builds, and release builds of the local flavour, have no development sign-in:
 * the real panel lives in `src/localDebug` only (see `checkNoDevSignIn` in `build.gradle.kts`).
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun DevSignInPanel(graph: AppGraph) = Unit
