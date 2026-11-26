package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.desk.DeskFamilySheet
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.android.ui.story.PresentScreen
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.consents.ConsentsStateHolder
import com.aarogyam.staff.desk.FamilyStateHolder
import com.aarogyam.staff.history.VisitHistoryState
import com.aarogyam.staff.history.VisitHistoryStateHolder
import com.aarogyam.staff.patients.OverviewState
import com.aarogyam.staff.patients.Patient360State
import com.aarogyam.staff.patients.Patient360StateHolder
import com.aarogyam.staff.patients.PatientOverviewStateHolder
import com.aarogyam.staff.story.showPatientVisit
import com.aarogyam.staff.visit.RecallsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

private enum class PatientSheet { Book, Share, Photo, Family, Edit }

/**
 * The patient page: the tonal header (flags, quick actions, the money strip for roles with money),
 * Start treatment for clinicians, then three pill tabs: Overview, History and Consent. A tap on a
 * visit opens its detail. The holders live here so switching tabs does not reload them.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun PatientPage(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    onBack: () -> Unit,
    onOpenVisit: (String) -> Unit,
    onStartTreatment: (String) -> Unit,
) {
    val holder = rememberHolder { graph.patient360(clinic, patientId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    val can = clinic.permissions
    val clinical = "clinical.read" in can
    val overview = if (clinical) rememberHolder { PatientOverviewStateHolder(clinic, patientId, it) } else null
    val chart = if (clinical) rememberHolder { graph.chart(clinic, patientId, it) } else null
    val recalls =
        if (clinical) {
            rememberHolder {
                RecallsStateHolder(clinic, patientId, it).also(RecallsStateHolder::load)
            }
        } else {
            null
        }
    val history = rememberHolder { VisitHistoryStateHolder(clinic, patientId, it) }
    val consents = rememberHolder { ConsentsStateHolder(clinic, patientId, it) }
    val historyState by history.state.collectAsStateWithLifecycle()
    val overviewState = overview?.state?.collectAsStateWithLifecycle()?.value
    var tab by rememberSaveable { mutableStateOf(PatientPageTab.Overview) }
    var sheet by remember { mutableStateOf<PatientSheet?>(null) }
    var presenting by remember { mutableStateOf<String?>(null) }
    val loaded = state as? Patient360State.Loaded
    // A queued picture lands in the Overview tiles once the outbox has sent it.
    OutboxRefresh(graph) { overview?.refresh() }
    // Coming back from a visit's detail: a payment there changes the balance, the money strip and the visit list.
    var seen by remember { mutableStateOf(false) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (seen) {
            holder.refresh()
            overview?.refresh()
            history.refresh()
        }
        seen = true
    }
    Column(Modifier.fillMaxSize()) {
        StatusBarTone.DarkHeader()
        SkTopBar(
            title = loaded?.view?.name ?: stringResource(R.string.patient_title),
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
            actions = {
                val showVisit = showPatientVisit(loaded?.view?.visits).takeIf { "clinical.read" in clinic.permissions }
                if (loaded != null && "patients.write" in clinic.permissions) {
                    BarAction(stringResource(R.string.pv_edit_action), SkTheme.colors.onBrandDark.color, {
                        sheet = PatientSheet.Edit
                    })
                }
                if (loaded != null && "patients.read" in clinic.permissions && ServerCaps.family) {
                    BarAction(stringResource(R.string.dk_d9_family_section), SkTheme.colors.onBrandDark.color, {
                        sheet = PatientSheet.Family
                    })
                }
                if (showVisit != null) {
                    BarAction(stringResource(R.string.vv_present_open), SkTheme.colors.onBrandDark.color, {
                        presenting =
                            showVisit
                    })
                }
                if (loaded !=
                    null
                ) {
                    BarAction(stringResource(R.string.pv_share), SkTheme.colors.onBrandDark.color, {
                        sheet =
                            PatientSheet.Share
                    })
                }
            },
        )
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f).navigationBarsPadding(),
        ) {
            if (loaded == null) {
                Placeholder(state, holder)
            } else {
                val tabs = PatientPageTab.visible(can)
                val current = if (tab in tabs) tab else tabs.firstOrNull() ?: PatientPageTab.Overview
                LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    item {
                        Column {
                            PatientHeader(
                                loaded.view,
                                canBook = "appointments.write" in can,
                                canPhoto = "clinical.write" in can,
                                onBook = { sheet = PatientSheet.Book },
                                onPhoto = { sheet = PatientSheet.Photo },
                            ) {
                                OutboxBadge(graph)
                                val money = (overviewState as? OverviewState.Loaded)
                                PatientMoneyStrip(
                                    MoneyStripModel.make(money?.money, money?.moneyShown ?: false),
                                ) { overview?.toggleMoney() }
                            }
                            loaded.error?.let {
                                Text(
                                    stringResource(it.message()),
                                    style = v7(12.5f),
                                    color = SkTheme.palette.error.color,
                                    modifier = Modifier.padding(Spacing.L.dp),
                                )
                            }
                            if ("clinical.write" in can) {
                                SkPillButton(
                                    stringResource(R.string.p9_start_treatment),
                                    { onStartTreatment(patientId) },
                                    modifier =
                                        Modifier
                                            .padding(
                                                start = Spacing.L.dp,
                                                end = Spacing.L.dp,
                                                top = 12.dp,
                                            ).fillMaxWidth(),
                                    variant = SkPillVariant.Warm,
                                    icon = PatientIcons.of("tooth"),
                                    wide = true,
                                )
                            }
                        }
                    }
                    stickyHeader {
                        PatientPillTabs(tabs, current, (historyState as? VisitHistoryState.Loaded)?.rows?.size) {
                            tab =
                                it
                        }
                    }
                    item {
                        Column(
                            Modifier.padding(
                                start = Spacing.L.dp,
                                end = Spacing.L.dp,
                                top = 6.dp,
                                bottom = Spacing.XXL.dp,
                            ),
                        ) {
                            TabBody(current, graph, clinic, overview, chart, recalls, history, consents, onOpenVisit)
                        }
                    }
                }
            }
        }
    }
    when (sheet) {
        PatientSheet.Book -> {
            BookSheet(graph, clinic, patientId, loaded?.view?.name.orEmpty()) { sheet = null }
        }

        PatientSheet.Photo -> {
            PhotoSheet(graph, clinic, patientId) { sheet = null }
        }

        PatientSheet.Share -> {
            ShareSheet(graph, clinic, patientId) { sheet = null }
        }

        PatientSheet.Family -> {
            // Adding and removing need patients.write; the holder checks that.
            val scope = rememberCoroutineScope()
            val family = remember(patientId) { FamilyStateHolder(clinic, patientId, scope) }
            DeskFamilySheet(family, loaded?.view?.name.orEmpty(), patientId) { sheet = null }
        }

        null -> {}
        PatientSheet.Edit -> {
            loaded?.view?.let { EditPatientSheet(graph, clinic, it, onSaved = holder::refresh) { sheet = null } }
        }

    }
    presenting?.let { visitId ->
        PresentScreen(graph, clinic, visitId, onAddDepth = {}, onClose = { presenting = null })
    }
}

@Composable
private fun TabBody(
    tab: PatientPageTab,
    graph: AppGraph,
    clinic: ClinicContext,
    overview: PatientOverviewStateHolder?,
    chart: com.aarogyam.staff.chart.ChartStateHolder?,
    recalls: RecallsStateHolder?,
    history: VisitHistoryStateHolder,
    consents: ConsentsStateHolder,
    onOpenVisit: (String) -> Unit,
) {
    when (tab) {
        PatientPageTab.Overview -> {
            if (overview !=
                null
            ) {
                OverviewTab(graph, clinic, overview, chart, recalls, onOpenVisit)
            }
        }

        PatientPageTab.History -> {
            HistoryTab(history, clinic, onOpenVisit)
        }

        PatientPageTab.Consent -> {
            ConsentTab(consents)
        }
    }
}

@Composable
private fun Placeholder(
    state: Patient360State,
    holder: Patient360StateHolder,
) {
    when (state) {
        Patient360State.Loading -> {
            LoadingIndicator()
        }

        Patient360State.NotAllowed -> {
            SkEmptyState(
                stringResource(R.string.patient_not_allowed_title),
                stringResource(R.string.patient_not_allowed_message),
            )
        }

        is Patient360State.Failed -> {
            SkEmptyState(
                stringResource(R.string.patient_title),
                stringResource(state.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = holder::refresh,
            )
        }

        is Patient360State.Loaded -> {}
    }
}

/** Runs [refresh] when the outbox empties after having something to send. */
@Composable
private fun OutboxRefresh(
    graph: AppGraph,
    refresh: () -> Unit,
) {
    val pending by graph.outbox.pending.collectAsStateWithLifecycle()
    var last by remember { mutableStateOf(0) }
    LaunchedEffect(pending) {
        if (last > 0 && pending == 0) refresh()
        last = pending
    }
}
