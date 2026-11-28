package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.PollingUpdates
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.PatientQrSheet
import com.aarogyam.staff.android.ui.TodayScreen
import com.aarogyam.staff.android.ui.desk.DeskHome
import com.aarogyam.staff.android.ui.doctor.DoctorWaitingTop
import com.aarogyam.staff.android.ui.more.AvatarChoice
import com.aarogyam.staff.android.ui.more.AvatarPicker
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.android.ui.tasks.TasksSheet
import com.aarogyam.staff.android.ui.visit.openVisitFromQueue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.nav.Home
import com.aarogyam.staff.nav.homeChoiceOf
import com.aarogyam.staff.nav.showsTasksOnHome
import com.aarogyam.staff.pollWhileInFront
import com.aarogyam.staff.settings.PatientQr
import com.aarogyam.staff.settings.PatientQrTab

/** What the Today tab shows, decided from permissions alone (iOS `TodayV10Logic`). */
object TodayLogic {
    /** The Desk home replaces the Today list for a person whose home is the Desk. */
    fun usesDesk(permissions: Set<String>): Boolean = homeChoiceOf(permissions).home == Home.Desk

    /** The My tasks button shows for front desk and assistants, not doctors and owners (shared rule). */
    fun showsTasks(permissions: Set<String>): Boolean = showsTasksOnHome(permissions)

    /** The doctor's "Waiting for you" card sits above Today for anyone who can write clinical notes. */
    fun showsWaitingCard(permissions: Set<String>): Boolean = "clinical.write" in permissions
}

/**
 * Today with its sheets (notifications, tasks, QR, avatar): the doctor's waiting card on top, the Desk home for the
 * desk role, the unread badge refreshed every minute and Today and the bell every 20 seconds while in front.
 */
@Composable
fun TodayTab(
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
    onOpenPatient: (String) -> Unit,
    onOpenSchedule: () -> Unit,
    onOpenOnline: () -> Unit,
    onAddExpense: () -> Unit,
    onWalkIn: () -> Unit,
) {
    var notifications by rememberSaveable { mutableStateOf(false) }
    var tasksOpen by rememberSaveable { mutableStateOf(false) }
    var qr by rememberSaveable { mutableStateOf(false) }
    val onBook = onWalkIn.takeIf { PatientQr.canBook(clinic.permissions) }
    var avatarSheet by rememberSaveable { mutableStateOf(false) }
    var avatar by remember {
        mutableStateOf(
            graph.preferences.get(PreferenceKey.AvatarChoice) ?: defaultAvatar(clinic),
        )
    }
    val context = LocalContext.current
    LaunchedEffect(clinic) {
        if (AvatarChoice.pull(context, graph, clinic)) {
            avatar = graph.preferences.get(PreferenceKey.AvatarChoice) ?: defaultAvatar(clinic)
        }
    }
    val badges = rememberHolder { graph.badges(clinic, it) }
    val counts by badges.state.collectAsStateWithLifecycle()
    val tasks = rememberHolder { graph.myTasks(clinic, it) }
    val taskState by tasks.state.collectAsStateWithLifecycle()
    val usesDesk = TodayLogic.usesDesk(clinic.permissions)
    val showsTasks = TodayLogic.showsTasks(clinic.permissions)
    LaunchedEffect(badges) { pollWhileInFront(BADGE_POLL_MS) { badges.refresh() } }
    LaunchedEffect(tasks) {
        if (showsTasks) pollWhileInFront(PollingUpdates.POLL_MILLIS) { tasks.refresh() }
    }
    Column(Modifier.fillMaxSize()) {
        val card = TodayLogic.showsWaitingCard(clinic.permissions)
        if (card) {
            // The card sits at the very top, so it clears the status bar; Today below then has no inset left to add.
            Box(Modifier.statusBarsPadding()) { DoctorWaitingTop(graph, clinic) { nav.openVisitFromQueue(it) } }
        }
        Box(Modifier.weight(1f).then(if (card) Modifier.consumeWindowInsets(WindowInsets.statusBars) else Modifier)) {
            if (usesDesk) {
                DeskHome(graph, clinic, nav)
                Row(
                    Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (showsTasks) TasksButton(taskState.openCount, { tasksOpen = true }, Modifier)
                    IconWell("qr", stringResource(R.string.pqr_title), { qr = true })
                    if (onBook != null) IconWell("cal", stringResource(R.string.pqr_book_action), onBook)
                }
            } else {
                val today = rememberHolder { graph.today(clinic, it) }
                LaunchedEffect(today) { pollWhileInFront(PollingUpdates.POLL_MILLIS) { today.refresh() } }
                TodayScreen(
                    today,
                    roleName = clinic.roleName,
                    avatar = avatar,
                    onOpenPatient = onOpenPatient,
                    onOpenSchedule = onOpenSchedule,
                    onOpenOnline = onOpenOnline.takeIf { "appointments.write" in clinic.permissions },
                    onAddExpense = onAddExpense,
                    onEditAvatar = { avatarSheet = true },
                    onQr = { qr = true },
                    onBook = onBook,
                    onNotifications = { notifications = true },
                    unread = counts.notifications > 0,
                    onTasks = { tasksOpen = true }.takeIf { showsTasks },
                    openTasks = taskState.openCount,
                )
            }
        }
    }
    if (notifications) {
        NotificationsSheet(
            rememberHolder { graph.notifications(clinic, it) },
            onOpenPatient = {
                notifications = false
                onOpenPatient(it)
            },
        ) { notifications = false }
    }
    if (tasksOpen) TasksSheet(graph, clinic, tasks) { tasksOpen = false }
    if (qr) PatientQrSheet(graph, clinic, PatientQrTab.CheckIn) { qr = false }
    if (avatarSheet) {
        AvatarPicker(graph, clinic, onChange = {
            avatar =
                graph.preferences.get(PreferenceKey.AvatarChoice) ?: defaultAvatar(clinic)
        }) { avatarSheet = false }
    }
}

/** My tasks for the Desk home, which draws its own header: a round button with the open count. */
@Composable
private fun TasksButton(
    open: Int,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier) {
        IconWell("check", stringResource(R.string.sh_tasks10_title), onClick, badge = open > 0)
    }
}

/** One of the eight illustrated avatars, stable for a member until they pick their own. */
private fun defaultAvatar(clinic: ClinicContext): String =
    "d${(
        clinic.session.membership.id
            .hashCode() and Int.MAX_VALUE
    ) % AVATARS + 1}"

private const val AVATARS = 8
private const val BADGE_POLL_MS = 60_000L
