package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.PatientPhotoLabel
import com.aarogyam.staff.android.ui.patient.PhotoSheet
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Patient360State
import com.aarogyam.staff.prescriptions.RxPhase
import com.aarogyam.staff.visit.NoteSave
import com.aarogyam.staff.visit.VisitShareStateHolder
import com.aarogyam.staff.visit.VisitStateHolder
import com.aarogyam.staff.visit.VisitView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter

private const val CLINICAL_WRITE = "clinical.write"

/** The open visit's scroll: header, notes, prescription, procedures and close, with the state the close needs. */
@Composable
internal fun VisitContent(
    graph: AppGraph,
    clinic: ClinicContext,
    target: VisitTarget,
    holder: VisitStateHolder,
    view: VisitView,
    patient: Patient360State,
    onBack: () -> Unit,
    onCollect: (invoiceId: String?) -> Unit,
) {
    val person = (patient as? Patient360State.Loaded)?.view
    val rx =
        rememberHolder { graph.rxSheet(clinic, target.patientId, person?.flags?.allergies.orEmpty(), it, view.visitId) }
    val rxState by rx.state.collectAsStateWithLifecycle()
    val chart = rememberHolder { graph.chart(clinic, target.patientId, it) }
    val chartState by chart.state.collectAsStateWithLifecycle()
    val sheet = rememberHolder { graph.toothSheet(clinic, chart, view.visitId, it) }
    val scope = rememberCoroutineScope()
    var rxOpen by remember { mutableStateOf(false) }
    var staged by remember { mutableStateOf(emptyList<StagedProcedure>()) }
    var confirm by remember { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    var closeError by remember { mutableStateOf<Int?>(null) }
    var snapshot by remember { mutableStateOf(VisitSnapshot()) }
    val form = remember { CloseForm() }
    val online = rememberOnline()
    val canBill = "billing.write" in clinic.permissions
    val canFollowUp = "patients.write" in clinic.permissions

    /** Saves what is staged on the visit; true when nothing is left. */
    suspend fun saveStaged(): Boolean {
        val left = commitProcedures(sheet, staged)
        staged = left
        return left.isEmpty()
    }

    fun performClose() {
        if (closing) return
        confirm = false
        closeError = null
        closing = true
        snapshot =
            VisitSnapshot(
                procedures = staged.map { "${it.term.label} · ${it.tooth}" },
                notes = view.bullets.size,
                rxNumber = rxState.issued?.number,
                medicines = if (rxState.phase == RxPhase.Issued) rxState.lines.size else 0,
                followUp = if (form.followUpOn && canFollowUp) form.followUpDate else null,
                feePaise = if (canBill) VisitMoney.paise(form.feeText) else null,
            )
        scope.launch {
            if (!saveStaged()) {
                closing = false
                return@launch run { closeError = R.string.vv_v9v_close_procedures_failed }
            }
            if (view.bullets.isNotEmpty() && view.save != NoteSave.Signed) {
                holder.sign()
                if (!waitSigned(holder)) {
                    closing = false
                    return@launch run { closeError = R.string.vv_v9v_close_sign_failed }
                }
            }
            holder.closeWith(
                followUpOn =
                    if (form.followUpOn &&
                        canFollowUp
                    ) {
                        form.followUpDate.format(DateTimeFormatter.ISO_LOCAL_DATE)
                    } else {
                        null
                    },
                reason = null,
                feePaise = if (canBill) VisitMoney.paise(form.feeText) else null,
            )
            closing = false
        }
    }

    fun requestClose() {
        when (CloseGuard.decide(rxState.lines.size, rxState.phase == RxPhase.Issued)) {
            CloseDecision.Close -> performClose()
            CloseDecision.ConfirmUnsigned -> confirm = true
        }
    }

    fun signNow() {
        confirm = false
        rxOpen = true
        if (rxState.canIssue) rx.issue()
    }

    val firstName =
        person?.name?.trim()?.split(' ')?.firstOrNull().orEmpty().ifEmpty {
            stringResource(R.string.vv_v9v_patient)
        }
    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .navigationBarsPadding(),
    ) {
        VisitHeader(graph, view, patient, target.chair)
        Column(
            Modifier.padding(horizontal = Spacing.L.dp, vertical = Spacing.ML.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
        ) {
            if (view.closed) {
                val minutes =
                    view.startedAt?.let {
                        ((System.currentTimeMillis() / MILLIS - it.epochSeconds) / MINUTE)
                            .coerceAtLeast(
                                1,
                            )
                    }
                        ?: 1L
                VisitSummary(
                    snapshot,
                    minutes,
                    firstName,
                    share = {
                        if ("clinical.read" in clinic.permissions) {
                            VisitShareSummary(
                                rememberHolder { VisitShareStateHolder(clinic, view.visitId, it) },
                                person?.phone,
                            )
                        }
                    },
                    onBack = onBack,
                )
            } else {
                if (!online) OfflineBanner()
                VisitEntry(graph, clinic, target.patientId, holder, view, rx, ::saveStaged, onCollect)
                VisitNotes(holder, view)
                VisitRxCard(rx, rxState, person?.phone, "prescriptions.issue" in clinic.permissions, rxOpen) {
                    rxOpen =
                        it
                }
                VisitProcedures(chart, chartState, staged, { staged = it }, locked = closing || view.closing)
                VisitCloseArea(
                    form,
                    confirm,
                    canBill,
                    canFollowUp,
                    closing || view.closing,
                    closeError?.let { stringResource(it) } ?: view.error?.let { stringResource(it.message()) },
                    onClose = ::requestClose,
                    onCloseAnyway = ::performClose,
                    onSignNow = ::signNow,
                )
            }
        }
    }
    // Edge to edge: once the header scrolls away, the cards would show through the status bar.
    Box(
        Modifier
            .fillMaxWidth()
            .windowInsetsTopHeight(WindowInsets.statusBars)
            .background(SkTheme.colors.brandDark.color),
    )
}

/** The two doctor entry points on the open visit: Chair mode (full screen) and Wrap up (sheet). */
@Composable
private fun VisitEntry(
    graph: AppGraph,
    clinic: ClinicContext,
    patientId: String,
    holder: VisitStateHolder,
    view: VisitView,
    rx: com.aarogyam.staff.prescriptions.RxSheetStateHolder,
    saveStaged: suspend () -> Boolean,
    onCollect: (invoiceId: String?) -> Unit,
) {
    var chair by remember { mutableStateOf(false) }
    var wrap by remember { mutableStateOf(false) }
    var image by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        SkButton(stringResource(R.string.vv_dv10_chair_open), onClick = {
            chair = true
        }, variant = SkButtonVariant.Secondary, modifier = Modifier.weight(1f))
        if (CLINICAL_WRITE in clinic.permissions) {
            SkButton(
                stringResource(R.string.vv_dv10_wrap_open),
                onClick = { wrap = true },
                modifier = Modifier.weight(1f),
            )
        }
    }
    // Right after Start visit the first picture is usually the OPG: the camera, labelled so.
    if ("patients.write" in clinic.permissions || CLINICAL_WRITE in clinic.permissions) {
        SkButton(
            stringResource(R.string.vv_visit_add_image),
            onClick = { image = true },
            variant = SkButtonVariant.Secondary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
    if (image) PhotoSheet(graph, clinic, patientId, PatientPhotoLabel.Opg) { image = false }
    if (chair) ChairMode(graph, clinic, patientId, holder, view) { chair = false }
    if (wrap) WrapUpSheet(graph, clinic, patientId, view.visitId, holder, rx, saveStaged, onCollect) { wrap = false }
}

private const val MILLIS = 1000L
private const val MINUTE = 60L
