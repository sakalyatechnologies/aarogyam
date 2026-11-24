package com.aarogyam.staff.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.push.PushInbox
import com.aarogyam.staff.android.ui.clinical.openLabs
import com.aarogyam.staff.android.ui.desk.openDeskBoard
import com.aarogyam.staff.android.ui.more.openTimeOff
import com.aarogyam.staff.android.ui.patient.openPatient
import com.aarogyam.staff.api.markNotificationRead
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.nav.Home
import com.aarogyam.staff.nav.homeChoiceOf
import com.aarogyam.staff.notifications.PushScreen
import com.aarogyam.staff.notifications.PushTap
import com.sakalya.mobile.core.Outcome

/**
 * Opens what a tapped alert names. First (signed in) it switches to the alert's clinic when that is
 * not the open one and marks the alert read; then, on the main screen, it moves to the screen.
 */
@Composable
fun PushTapEffect(
    graph: AppGraph,
    nav: NavController,
    signedIn: Boolean,
    onMain: Boolean,
) {
    val tap by PushInbox.tap.collectAsStateWithLifecycle()
    val clinic by graph.directory.current.collectAsStateWithLifecycle()
    var ready by remember { mutableStateOf<PushTap?>(null) }
    LaunchedEffect(tap, signedIn, clinic) {
        val held = tap ?: return@LaunchedEffect
        if (!signedIn) return@LaunchedEffect
        val open = clinic
        if (held.orgId != null && open?.session?.clinic?.id != held.orgId) {
            val target =
                (graph.directory.clinics() as? Outcome.Success)?.value?.firstOrNull { it.orgId == held.orgId }
            if (target == null) {
                PushInbox.setTap(null)
                return@LaunchedEffect
            }
            graph.directory.open(target)
            // `current` changes, which runs this effect again with the right clinic open.
            return@LaunchedEffect
        }
        if (open == null) return@LaunchedEffect
        held.notificationId?.let { open.api.markNotificationRead(it) }
        PushInbox.setTap(null)
        ready = held
    }
    LaunchedEffect(ready, onMain, clinic) {
        val held = ready ?: return@LaunchedEffect
        val open = clinic
        if (!onMain || open == null) return@LaunchedEffect
        ready = null
        val patient = PushTap.patientIdFor(held.href)
        if (patient != null) {
            nav.openPatient(patient)
            return@LaunchedEffect
        }
        when (held.screen) {
            PushScreen.Labs -> {
                nav.openLabs()
            }

            PushScreen.TimeOff -> {
                nav.openTimeOff()
            }

            // The doctor's waiting list is on Today; the desk board is for the desk.
            PushScreen.Queue -> {
                if (homeChoiceOf(open.permissions).home ==
                    Home.Doctor
                ) {
                    PushInbox.requestToday(true)
                } else {
                    nav.openDeskBoard()
                }
            }

            // My tasks opens from Today.
            PushScreen.Tasks, PushScreen.Today -> {
                PushInbox.requestToday(true)
            }
        }
    }
}

/** Android 13 and newer: one explanation before the system prompt, asked once after sign-in. */
@Composable
fun PushPrompt(graph: AppGraph) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    var asking by remember {
        val granted =
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        mutableStateOf(
            !granted && graph.preferences.get(PreferenceKey.PushAsked) == null && PushInbox.firebaseReady(context),
        )
    }
    if (!asking) return
    AlertDialog(
        onDismissRequest = {},
        title = { Text(stringResource(R.string.push_ask_title)) },
        text = { Text(stringResource(R.string.push_ask_message)) },
        confirmButton = {
            TextButton(onClick = {
                graph.preferences.set(PreferenceKey.PushAsked, "1")
                asking = false
                launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }) { Text(stringResource(R.string.push_ask_allow)) }
        },
        dismissButton = {
            TextButton(onClick = {
                graph.preferences.set(PreferenceKey.PushAsked, "1")
                asking = false
            }) { Text(stringResource(R.string.push_ask_later)) }
        },
    )
}
