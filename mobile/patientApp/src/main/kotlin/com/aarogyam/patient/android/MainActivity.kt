package com.aarogyam.patient.android

import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.aarogyam.patient.android.ui.AppRoot

/** The single activity; every screen is Compose. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Health screens: no screenshots, no recordings, blank in the app switcher. The local debug
        // build shows synthetic seed data only, so QA may screenshot it.
        if (!(BuildConfig.DEBUG && BuildConfig.ENVIRONMENT == "Local")) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        setContent { AppRoot((application as PatientApp).graph) }
    }
}
