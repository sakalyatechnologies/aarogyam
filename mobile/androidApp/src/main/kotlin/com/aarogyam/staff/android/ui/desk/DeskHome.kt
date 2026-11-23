package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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
import com.aarogyam.staff.android.ui.patient.openPatient
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.desk.DeskBoardStateHolder
import com.aarogyam.staff.desk.DeskLookupState
import com.aarogyam.staff.desk.DeskLookupStateHolder
import com.aarogyam.staff.desk.DeskProfile
import com.aarogyam.staff.desk.FamilyStateHolder
import com.aarogyam.staff.desk.MissedHolder
import com.aarogyam.staff.desk.ToCollectHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The desk role's Today (v10 A1 to A3): the availability strip, a mobile field that searches by itself at ten
 * digits, profile chips, "Check in · Dr X", the waiting-room board, then the unpaid and missed sections.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeskHome(
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
) {
    val feed = rememberHolder { DeskFeed(clinic, it) }
    val board = rememberHolder<DeskBoardStateHolder> { DeskBoardStateHolder(clinic, it) }
    val toCollect = rememberHolder<ToCollectHolder> { ToCollectHolder(clinic, it) }
    val missed = rememberHolder<MissedHolder> { MissedHolder(clinic, it) }
    val lookup = rememberHolder { graph.desk(clinic, it) }
    val feedState by feed.state.collectAsStateWithLifecycle()
    val boardState by board.state.collectAsStateWithLifecycle()
    val lookupState by lookup.state.collectAsStateWithLifecycle()
    val online by graph.connectivity.online.collectAsStateWithLifecycle()
    var tick by remember { mutableIntStateOf(0) }
    var refreshing by remember { mutableStateOf(false) }
    var paying by remember { mutableStateOf<DeskPayTarget?>(null) }
    var relatives by remember { mutableStateOf<DeskPayTarget?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Polls only in front (the shared live updates rest in the background); coming back reloads at once.
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
    val canCollect = DeskCollect.canCollect(clinic.permissions)
    val afterPayment = {
        paying = null
        board.refresh()
        tick++
        feed.refresh()
    }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            board.refresh()
            tick++
            feed.refresh()
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(
                    rememberScrollState(),
                ).padding(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            Text(
                stringResource(R.string.dk_dx_home_title),
                style = SkTypography.title,
                color = SkTheme.colors.text.color,
            )
            DeskStrip(feedState.strip)
            DeskFinderSection(clinic, nav, feed, lookup, lookupState, feedState, canCollect, onPay = {
                paying = it
            }, onFamily = {
                relatives =
                    it
            })
            DeskBoardContent(
                board,
                boardState,
                DeskBoardContext(
                    clinic = clinic,
                    roleKey = clinic.session.membership.roleKey,
                    permissions = clinic.permissions,
                    feed = feedState,
                    remind = feed::remind,
                    online = online,
                    onOpenPatient = nav::openPatient,
                    onCollect = { paying = it },
                ),
            )
            DeskUnpaidSection(
                toCollect,
                canCollect,
                tick,
                { paying = it },
                canSplit = "billing.read" in clinic.permissions && "billing.write" in clinic.permissions,
            )
            DeskMissedSection(missed, clinic.session.clinic.timezone, tick, nav::openPatient)
        }
    }
    paying?.let { target ->
        DeskPaymentSheet(graph, clinic, target, feedState.version, onDismiss = afterPayment)
    }
    relatives?.let { target ->
        val scope = rememberCoroutineScope()
        val family = remember(target.patientId) { FamilyStateHolder(clinic, target.patientId, scope) }
        DeskFamilySheet(family, target.name, target.patientId) { relatives = null }
    }
}

@Composable
private fun DeskFinderSection(
    clinic: ClinicContext,
    nav: NavController,
    feed: DeskFeed,
    lookup: DeskLookupStateHolder,
    state: DeskLookupState,
    feedState: DeskFeedState,
    canCollect: Boolean,
    onPay: (DeskPayTarget) -> Unit,
    onFamily: (DeskPayTarget) -> Unit,
) {
    var typed by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var chosenDoctor by rememberSaveable { mutableStateOf<String?>(null) }
    var tokenDone by rememberSaveable { mutableStateOf<Int?>(null) }
    var failed by remember { mutableStateOf(false) }
    var checkingIn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val change = { text: String ->
        typed = DeskPhone.format(text)
        selected = null
        chosenDoctor = null
        failed = false
        lookup.search(DeskPhone.query(typed))
    }
    LaunchedEffect(state) { if (state is DeskLookupState.CheckedIn) tokenDone = state.tokenNumber }
    val done = tokenDone
    if (done != null) {
        Text(
            stringResource(R.string.dk_dx_home_done, done),
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
        )
        DeskMutedText(stringResource(R.string.dk_dx_home_done_message))
        SkButton(
            stringResource(R.string.dk_dx_home_next),
            onClick = {
                tokenDone = null
                change("")
            },
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    DeskNumberField(typed, change, stringResource(R.string.dk_dx_home_number))
    DeskLookupStatus(lookup, state, typed) { nav.openDeskIntake(it, emptyList()) }
    if (failed) DeskErrorText(stringResource(R.string.dk_dx_home_checkin_failed))
    val matches = state as? DeskLookupState.Matches ?: return
    val profiles = matches.profiles
    val current =
        profiles.firstOrNull { it.id == selected } ?: profiles.firstOrNull { !it.checkedInToday }
            ?: profiles.firstOrNull()
    DeskWrap {
        profiles.forEach { p ->
            PickChip(
                p.name.ifEmpty { p.initials },
                selected = p.id == current?.id,
                onClick = {
                    selected = p.id
                    chosenDoctor = null
                },
            )
        }
    }
    if (current != null) {
        MatchActions(clinic, feedState, profiles, current, chosenDoctor, canCollect, checkingIn, {
            chosenDoctor = it
        }, onPay, onFamily) { patient, doctor ->
            checkingIn = true
            failed = false
            scope.launch {
                val token = feed.checkIn(patient.id, doctor?.id)
                if (token != null) tokenDone = token else failed = true
                checkingIn = false
            }
        }
    }
    SkButton(
        stringResource(R.string.dk_dx_home_new),
        onClick = {
            val anchors = profiles.filter { it.familyOf == null }.map { DeskFamilyAnchor(it.id, it.name) }
            nav.openDeskIntake(
                DeskPhone.newPatientPhone(matches.phone),
                if (ServerCaps.family &&
                    !matches.partial
                ) {
                    anchors
                } else {
                    emptyList()
                },
            )
        },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
@Suppress("LongParameterList")
private fun MatchActions(
    clinic: ClinicContext,
    feedState: DeskFeedState,
    profiles: List<DeskProfile>,
    current: DeskProfile,
    chosenDoctor: String?,
    canCollect: Boolean,
    checkingIn: Boolean,
    onChooseDoctor: (String) -> Unit,
    onPay: (DeskPayTarget) -> Unit,
    onFamily: (DeskPayTarget) -> Unit,
    onCheckIn: (DeskProfile, DeskDoctor?) -> Unit,
) {
    val doctor = DeskDoctors.pick(feedState.doctors, feedState.lastDoctor[current.id]?.id, chosenDoctor)
    if (!current.checkedInToday &&
        feedState.doctors.size > 1
    ) {
        DeskDoctorChips(feedState.doctors, doctor, onChooseDoctor)
    }
    val title =
        doctor?.let { stringResource(R.string.dk_dx_home_checkin, doctorLabel(it.name)) }
            ?: stringResource(R.string.dk_dx_home_checkin_nodoc)
    DeskProfileRow(
        profile = current,
        ofName = profiles.firstOrNull { it.id == current.familyOf }?.name,
        canCollect = canCollect,
        canFamily = "patients.read" in clinic.permissions && ServerCaps.family,
        onCheckIn = { if (!checkingIn) onCheckIn(current, doctor) },
        onCollect = { onPay(DeskPayTarget(current.id, current.name)) },
        onFamily = { onFamily(DeskPayTarget(current.id, current.name)) },
        checkInTitle = title,
    )
}

private const val REFRESH_MILLIS = 800L
