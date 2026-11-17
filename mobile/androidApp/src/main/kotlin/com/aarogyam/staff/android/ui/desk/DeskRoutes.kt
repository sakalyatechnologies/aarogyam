package com.aarogyam.staff.android.ui.desk

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/** Route names for the front desk (T13 desk worker). */
object DeskRoutes {
    const val LOOKUP = "desk/lookup"
    const val BOARD = "desk/board"
    const val INTAKE = "desk/intake?phone={phone}"
    const val PAY = "desk/pay/{tokenId}?invoice={invoice}"
}

/** The people on the number a new relative can be linked to, handed to the intake route without putting names in it. */
private object IntakeFamilyStash {
    var people: List<DeskFamilyAnchor> = emptyList()
}

/** The intake form (v10 T3) for a new patient; [phone] is prefilled when the desk already typed it. */
fun NavController.openDeskIntake(phone: String?) = openDeskIntake(phone, emptyList())

/** As [openDeskIntake], with the [family] on that number the patient can be linked to. */
fun NavController.openDeskIntake(
    phone: String?,
    family: List<DeskFamilyAnchor>,
) {
    IntakeFamilyStash.people = family
    navigate("desk/intake?phone=${Uri.encode(phone.orEmpty())}")
}

/** Collect payment for the patient of [tokenId], on [invoiceId] when the caller knows the bill. */
fun NavController.openDeskPayment(
    tokenId: String,
    invoiceId: String?,
) = navigate("desk/pay/${Uri.encode(tokenId)}?invoice=${Uri.encode(invoiceId.orEmpty())}")

/** The mobile-number lookup with check in and new patient. */
fun NavController.openDeskLookup() = navigate(DeskRoutes.LOOKUP)

/** The waiting-room board as its own screen. */
fun NavController.openDeskBoard() = navigate(DeskRoutes.BOARD)

fun NavGraphBuilder.deskDestinations(
    graph: AppGraph,
    clinic: () -> ClinicContext?,
    nav: NavController,
) {
    composable(DeskRoutes.LOOKUP) {
        val open = clinic() ?: return@composable
        DeskLookupScreen(
            graph,
            open,
            rememberHolder { graph.desk(open, it) },
            onClose = nav::popBackStack,
            onNewPatient = { phone, family -> nav.openDeskIntake(phone, family) },
        )
    }
    composable(DeskRoutes.BOARD) {
        val open = clinic() ?: return@composable
        DeskBoardScreen(graph, open, nav)
    }
    composable(
        DeskRoutes.INTAKE,
        arguments =
            listOf(
                navArgument("phone") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
    ) { entry ->
        val open = clinic() ?: return@composable
        val phone = entry.arguments?.getString("phone")?.takeIf { it.isNotBlank() }
        Column(Modifier.fillMaxSize()) {
            StatusBarTone.DarkHeader()
            SkTopBar(
                title = stringResource(R.string.dk_iv_title),
                actions = {
                    BarAction(
                        stringResource(R.string.dk_d9_back),
                        SkTheme.colors.onBrandDark.color,
                        nav::popBackStack,
                    )
                },
            )
            IntakeScreen(
                rememberHolder { graph.intakeForm(open, it) },
                phone,
                IntakeFamilyStash.people,
                onDone = nav::popBackStack,
            )
        }
    }
    composable(
        DeskRoutes.PAY,
        arguments =
            listOf(
                navArgument("tokenId") { type = NavType.StringType },
                navArgument("invoice") {
                    type = NavType.StringType
                    defaultValue = ""
                },
            ),
    ) { entry ->
        val open = clinic() ?: return@composable
        val tokenId = entry.arguments?.getString("tokenId") ?: return@composable
        val invoice = entry.arguments?.getString("invoice")?.takeIf { it.isNotBlank() }
        DeskPaymentScreen(graph, open, tokenId, invoice, nav::popBackStack)
    }
}

/** Collect payment as a screen: the token's patient is read from today's queue (one request). */
@Composable
private fun DeskPaymentScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    tokenId: String,
    invoiceId: String?,
    onClose: () -> Unit,
) {
    val target by produceState<DeskPayTarget?>(null, tokenId) {
        val token = (clinic.api.queue() as? Outcome.Success)?.value?.items?.firstOrNull { it.id == tokenId }
        value = token?.let { DeskPayTarget(it.patient.id, it.patient.fullName, invoiceId = invoiceId) }
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        StatusBarTone.DarkHeader()
        SkTopBar(
            title = stringResource(R.string.dk_d9_pay_title),
            subtitle = target?.name,
            actions = { BarAction(stringResource(R.string.dk_d9_back), SkTheme.colors.onBrandDark.color, onClose) },
        )
        val ready = target
        if (ready == null) {
            LoadingIndicator()
        } else {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(Spacing.ML.dp),
                verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
            ) {
                DeskPaymentBody(graph, clinic, ready, refreshTick = 0, onDone = onClose)
            }
        }
    }
}
