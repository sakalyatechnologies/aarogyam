package com.aarogyam.staff.android

import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import com.aarogyam.staff.android.ui.AppRoot

/** The single activity; every screen is Compose. AppCompat applies the in-app language. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Clinical screens: no screenshots, no recordings, blank in the app switcher.
        // The local debug build shows synthetic seed data only, so QA may screenshot it.
        if (!(BuildConfig.DEBUG && BuildConfig.ENVIRONMENT == "Local")) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        }
        // Every screen but sign-in opens with a dark brand header: light status bar icons.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        setContent { AppRoot((application as AarogyamApp).graph) }
    }
}
