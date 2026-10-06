package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.billing.BillingState
import com.aarogyam.staff.billing.BillingStateHolder
import com.aarogyam.staff.patients.AllergyView
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.FlagsView
import com.aarogyam.staff.patients.Patient360State
import com.aarogyam.staff.patients.Patient360StateHolder
import com.aarogyam.staff.patients.PatientView
import com.aarogyam.staff.patients.VisitView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTabs
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Patient 360: Overview (banner, contact, upcoming, visits, balance with `billing.read`), Chart, Rx and Billing tabs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Patient360Screen(
    holder: Patient360StateHolder,
    onBack: () -> Unit,
    chartTab: @Composable () -> Unit,
    rxTab: @Composable (PatientView) -> Unit,
    billing: BillingStateHolder,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val billingState by billing.state.collectAsStateWithLifecycle()
    // Without billing.read the Billing tab does not exist.
    val tabCount = if (billingState == BillingState.Hidden) TAB_BILLING else TABS.size
    val loaded = state as? Patient360State.Loaded
    // A recorded payment changes the balance on the Overview, so reload the patient.
    val receipt = (billingState as? BillingState.Loaded)?.receipt
    LaunchedEffect(receipt) { if (receipt != null) holder.refresh() }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = loaded?.view?.name ?: stringResource(R.string.patient_title),
            subtitle = loaded?.view?.let { header(it) },
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
        )
        var tab by rememberSaveable { mutableIntStateOf(0) }
        if (loaded != null) {
            SkTabs(
                titles = TABS.take(tabCount).map { stringResource(it) },
                selectedIndex = tab,
                onSelect = { tab = it },
            )
        }
        if (loaded != null && tab != TAB_OVERVIEW) {
            Box(Modifier.weight(1f).navigationBarsPadding()) {
                when (tab) {
                    TAB_CHART -> chartTab()
                    TAB_RX -> rxTab(loaded.view)
                    else -> BillingTab(billing)
                }
            }
            return@Column
        }
        PullToRefreshBox(
            isRefreshing = loaded?.refreshing == true,
            onRefresh = holder::refresh,
            modifier = Modifier.weight(1f).navigationBarsPadding(),
        ) {
            when (val current = state) {
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
                        stringResource(current.error.message()),
                        actionLabel = stringResource(R.string.try_again),
                        onAction = holder::refresh,
                    )
                }

                is Patient360State.Loaded -> {
                    Overview(current)
                }
            }
        }
    }
}

/** Patient 360's tabs, in order; the indices below pick each one's content. */
private val TABS =
    listOf(
        R.string.patient_tab_overview,
        R.string.patient_tab_chart,
        R.string.patient_tab_rx,
        R.string.patient_tab_billing,
    )
private const val TAB_OVERVIEW = 0
private const val TAB_CHART = 1
private const val TAB_RX = 2
private const val TAB_BILLING = 3

@Composable
private fun header(view: PatientView): String {
    val age = view.ageYears?.let { stringResource(R.string.age_years, it) }
    val sex = view.sex.label()?.let { stringResource(it) }
    return listOfNotNull(view.number, age, sex).joinToString(" · ")
}

@Composable
private fun Overview(state: Patient360State.Loaded) {
    val view = state.view
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        item { Banner(view.flags) }
        item { Contact(view) }
        item { Upcoming(view) }
        view.visits?.let { visits -> item { Visits(visits) } }
        view.balancePaise?.let { balance -> item { Balance(balance) } }
    }
}

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    SkCard {
        Text(
            title,
            style = SkTypography.headline,
            color = SkTheme.colors.text.color,
            modifier = Modifier.padding(bottom = Spacing.SM.dp),
        )
        content()
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)

@Composable
private fun Banner(flags: FlagsView) {
    Section(stringResource(R.string.flags_title)) {
        when {
            !flags.hasFlags -> {
                Muted(stringResource(R.string.flags_none))
            }

            flags.detailsHidden -> {
                Muted(stringResource(R.string.flags_counts, flags.allergyCount, flags.conditionCount))
                Muted(stringResource(R.string.flags_hidden))
            }

            else -> {
                flags.allergies.forEachIndexed { index, allergy ->
                    if (index > 0) SkDivider()
                    AllergyRow(allergy)
                }
                if (flags.allergies.isNotEmpty() && flags.conditions.isNotEmpty()) SkDivider()
                flags.conditions.forEach { SkListRow(it) }
            }
        }
    }
}

@Composable
private fun AllergyRow(allergy: AllergyView) {
    SkListRow(
        title = allergy.substance,
        subtitle = allergy.reaction,
        trailing = { SkChip(stringResource(allergy.severity.label()), tone = allergy.severity.tone()) },
    )
}

@Composable
private fun Contact(view: PatientView) {
    Section(stringResource(R.string.contact_title)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
            SkAvatar(view.name)
            Column {
                view.phone?.let { Text(it, style = SkTypography.bodyText, color = SkTheme.colors.text.color) }
                Muted(view.language)
            }
        }
        if (view.recallDue) {
            SkChip(
                stringResource(R.string.recall_due),
                tone = SkTone.Warning,
                modifier = Modifier.padding(top = Spacing.SM.dp),
            )
        }
    }
}

@Composable
private fun Upcoming(view: PatientView) {
    Section(stringResource(R.string.upcoming_title)) {
        val next = view.upcoming.firstOrNull()
        if (next == null) {
            Muted(stringResource(R.string.upcoming_none))
        } else {
            SkListRow(title = next.at.text(), subtitle = next.practitioner)
        }
    }
}

@Composable
private fun Visits(visits: List<VisitView>) {
    Section(stringResource(R.string.visits_title)) {
        if (visits.isEmpty()) Muted(stringResource(R.string.visits_none))
        visits.forEachIndexed { index, visit ->
            if (index > 0) SkDivider()
            SkListRow(
                title = visit.at.date.display(),
                subtitle = listOfNotNull(visit.reason, visit.clinician, visit.number).joinToString(" · "),
                trailing =
                    if (visit.open) {
                        (
                            {
                                SkChip(
                                    stringResource(R.string.visit_open),
                                    tone = SkTone.Brand,
                                )
                            }
                        )
                    } else {
                        null
                    },
            )
        }
    }
}

@Composable
private fun Balance(paise: Long) {
    Section(stringResource(R.string.balance_title)) {
        if (paise > 0) {
            Text(
                stringResource(R.string.balance_due, paise.rupees()),
                style = SkTypography.headline,
                color = SkTheme.colors.dangerText.color,
            )
        } else {
            Muted(stringResource(R.string.balance_clear))
        }
    }
}

private fun ClinicMoment.text(): String = "${date.display()} · ${time.display()}"
