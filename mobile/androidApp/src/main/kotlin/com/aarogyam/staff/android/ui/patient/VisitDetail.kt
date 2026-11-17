package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.billing.BillingState
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.history.CorrectableNote
import com.aarogyam.staff.history.VisitDetailState
import com.aarogyam.staff.history.VisitDetailView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/**
 * A past visit: summary cells, treatment done, notes by S, O, A and P, the prescription dose grid,
 * X-rays and photos, and the bill with Record payment.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VisitDetailScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    visitId: String,
    onBack: () -> Unit,
) {
    val holder =
        rememberHolder {
            com.aarogyam.staff.history
                .VisitDetailStateHolder(clinic, visitId, patientId, it)
        }
    val billing = rememberHolder { graph.billing(clinic, patientId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    val billingState by billing.state.collectAsStateWithLifecycle()
    val billLoaded = billingState as? BillingState.Loaded
    var sendRx by remember { mutableStateOf<VisitRxRef?>(null) }
    var correcting by remember { mutableStateOf<CorrectableNote?>(null) }
    var versionsOf by remember { mutableStateOf<String?>(null) }
    // A recorded payment changes the bill on this page.
    LaunchedEffect(billLoaded?.receipt) { if (billLoaded?.receipt != null) holder.refresh() }
    Column(Modifier.fillMaxSize().background(SkTheme.palette.background.color)) {
        SkTopBar(
            title = stringResource(R.string.p9_visit_title),
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
        )
        PullToRefreshBox(
            isRefreshing = (state as? VisitDetailState.Loaded)?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f).navigationBarsPadding(),
        ) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(
                        rememberScrollState(),
                    ).padding(horizontal = Spacing.L.dp)
                    .padding(top = 10.dp, bottom = Spacing.XXL.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val title = stringResource(R.string.p9_visit_title)
                when (val current = state) {
                    VisitDetailState.Loading -> {
                        SectionState(title, SectionKind.Loading)
                    }

                    VisitDetailState.NotAllowed -> {
                        SectionState(title, SectionKind.NotAllowed)
                    }

                    is VisitDetailState.Failed -> {
                        SectionState(title, SectionKind.Failed(current.error), holder::refresh)
                    }

                    is VisitDetailState.Loaded -> {
                        current.error?.let { ErrorLine(it) }
                        Detail(
                            current.view,
                            clinic,
                            billing,
                            billLoaded,
                            NoteActions({ correcting = it }, { versionsOf = it }),
                        ) { sendRx = it }
                    }
                }
            }
        }
    }
    billLoaded?.form?.let { PaymentSheet(billing, it) }
    sendRx?.let { ref -> SendRxSheet(graph, clinic, patientId, visitId, ref) { sendRx = null } }
    correcting?.let { note ->
        NoteCorrectionSheet(graph, clinic, note) { saved ->
            correcting = null
            if (saved) holder.refresh()
        }
    }
    versionsOf?.let { id -> NoteVersionsSheet(graph, clinic, id) { versionsOf = null } }
}

@Composable
private fun Detail(
    view: VisitDetailView,
    clinic: ClinicContext,
    billing: com.aarogyam.staff.billing.BillingStateHolder,
    billLoaded: BillingState.Loaded?,
    notes: NoteActions,
    onSendRx: (VisitRxRef) -> Unit,
) {
    val p = SkTheme.palette
    val title = historyTitleText(HistoryRowFormat.title(view.title, view.procedures.firstOrNull()?.name, null))
    val whenText = view.at?.let { it.date.display() + " · " + it.time.display() }
    Column(Modifier.semantics { heading() }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = v7(22f, FontWeight.ExtraBold), color = p.onSurface.color)
        Text(
            listOfNotNull(whenText, view.clinician).joinToString(" · "),
            style = v7(12.5f),
            color = p.onSurfaceVariant.color,
        )
    }
    Summary(view)
    TreatmentCard(view)
    NotesCard(view, notes)
    RxCard(view, "prescriptions.issue" in clinic.permissions, onSendRx)
    FilesCard(view)
    BillCard(view, billing, billLoaded)
}

@Composable
private fun Summary(view: VisitDetailView) {
    val teeth = view.procedures.mapNotNull { it.tooth }.toSortedSet()
    Flow(spacing = 8.dp) {
        SummaryCell(stringResource(R.string.p9_visit_treatments), view.procedures.size.toString())
        SummaryCell(stringResource(R.string.p9_visit_teeth), if (teeth.isEmpty()) "–" else teeth.joinToString(", "))
        SummaryCell(stringResource(R.string.p9_visit_medicines), (view.rx?.items?.size ?: 0).toString())
    }
}

@Composable
private fun SummaryCell(
    label: String,
    value: String,
) {
    val p = SkTheme.palette
    Column(
        Modifier.background(p.surface2.color, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(label, style = v7(11f, FontWeight.Bold), color = p.onSurfaceVariant.color)
        Text(value, style = v7(16f, FontWeight.ExtraBold), color = p.onSurface.color)
    }
}

@Composable
private fun TreatmentCard(view: VisitDetailView) {
    val p = SkTheme.palette
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(stringResource(R.string.p9_visit_done))
            if (view.procedures.isEmpty()) V7Muted(stringResource(R.string.p9_visit_done_none))
            view.procedures.forEach { proc ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        Text(proc.name, style = v7(14f, FontWeight.Bold), color = p.onSurface.color)
                        Text(
                            proc.tooth?.let { stringResource(R.string.p9_tooth_n, it) }
                                ?: stringResource(R.string.p9_whole_mouth),
                            style = v7(12f),
                            color = p.onSurfaceVariant.color,
                        )
                    }
                    proc.feePaise?.let {
                        Text(
                            it.rupees(),
                            style = v7(14f, FontWeight.Bold),
                            color = p.onSurface.color,
                        )
                    }
                }
            }
        }
    }
}

/** Correct a note, or read the versions a correction replaced. */
private class NoteActions(
    val correct: (CorrectableNote) -> Unit,
    val versions: (String) -> Unit,
)

@Composable
private fun NotesCard(
    view: VisitDetailView,
    actions: NoteActions,
) {
    val p = SkTheme.palette
    val notes = view.notes
    val groups =
        listOf(
            R.string.p9_note_s to notes.subjective,
            R.string.p9_note_o to notes.objective,
            R.string.p9_note_a to notes.assessment,
            R.string.p9_note_p to notes.plan,
        ).filter { it.second.isNotEmpty() }
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(
                stringResource(R.string.p9_visit_notes),
                notes.signedBy?.let {
                    stringResource(R.string.p9_visit_signed_by, it)
                },
            )
            if (groups.isEmpty()) V7Muted(stringResource(R.string.p9_visit_notes_none))
            groups.forEach { (nameRes, lines) ->
                val name = stringResource(nameRes)
                lines.forEach { line ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            name.uppercase(),
                            style = v7(10.5f, FontWeight.ExtraBold),
                            color = p.onPrimaryContainer.color,
                            maxLines = 1,
                            modifier =
                                Modifier
                                    .background(
                                        p.primaryContainer.color,
                                        CircleShape,
                                    ).padding(horizontal = 8.dp, vertical = 3.dp),
                        )
                        Text(line, style = v7(14f), color = p.onSurface.color, modifier = Modifier.weight(1f))
                    }
                }
            }
            view.correctable.forEach { note -> CorrectRow(note, view.correctable.size > 1, actions) }
        }
    }
}

/** Under the notes: "Corrected · Earlier version" when it is a correction, and Correct note. */
@Composable
private fun CorrectRow(
    note: CorrectableNote,
    named: Boolean,
    actions: NoteActions,
) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (note.corrected) {
            V7Pill(stringResource(R.string.p9_note_corrected), PillKind.Neutral)
            SkPillButton(
                stringResource(R.string.p9_note_versions),
                { actions.versions(note.id) },
                variant = SkPillVariant.Ghost,
            )
        }
        Spacer(Modifier.weight(1f))
        SkPillButton(
            if (named) {
                stringResource(
                    R.string.p9_note_correct_of,
                    note.author,
                )
            } else {
                stringResource(R.string.p9_note_correct)
            },
            { actions.correct(note) },
            variant = SkPillVariant.Tonal,
        )
    }
}
