package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Patient360State
import com.aarogyam.staff.visit.VisitState
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** Where the visit came from: a queue token (with the chair the queue knows) or a patient (or appointment). */
internal data class VisitTarget(
    val patientId: String,
    val tokenId: String? = null,
    val appointmentId: String? = null,
    val chair: Int? = null,
)

/** Start treatment as one screen; this file owns the states around the open visit (`VisitContent`). */
@Composable
internal fun VisitScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    target: VisitTarget,
    onBack: () -> Unit,
    onCollect: (invoiceId: String?) -> Unit,
) {
    val patientHolder = rememberHolder { graph.patient360(clinic, target.patientId, it) }
    val patient by patientHolder.state.collectAsStateWithLifecycle()
    val holder = rememberHolder { graph.visit(clinic, target.patientId, target.tokenId, target.appointmentId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize().background(SkTheme.colors.background.color)) {
        when (val current = state) {
            VisitState.Starting -> {
                LoadingIndicator()
            }

            VisitState.NotAllowed -> {
                SkEmptyState(
                    stringResource(R.string.vv_c_visit_not_allowed_title),
                    stringResource(R.string.vv_c_visit_not_allowed_message),
                )
            }

            is VisitState.Failed -> {
                Column(Modifier.padding(Spacing.L.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    SkEmptyState(stringResource(R.string.vv_v9v_failed_title), stringResource(current.error.message()))
                    SkButton(
                        stringResource(R.string.vv_v9v_back),
                        onClick = onBack,
                        variant = SkButtonVariant.Secondary,
                    )
                }
            }

            is VisitState.Open -> {
                if (patient is Patient360State.Loading) {
                    LoadingIndicator()
                } else {
                    VisitContent(graph, clinic, target, holder, current.view, patient, onBack, onCollect)
                }
            }
        }
    }
}
