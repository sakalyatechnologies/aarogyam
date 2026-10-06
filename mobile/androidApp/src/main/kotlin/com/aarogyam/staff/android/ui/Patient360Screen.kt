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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
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

/**
 * Patient 360: the header and tabs ([PatientTab]). Overview holds the safety banner, upcoming
 * appointment, recent visits and (with `billing.read`) the balance; [tabContent] draws the others.
 */
@Composable
fun Patient360Screen(
    holder: Patient360StateHolder,
    onBack: () -> Unit,
    tabContent: @Composable (PatientTab) -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val loaded = state as? Patient360State.Loaded
    var tab by rememberSaveable { mutableStateOf(PatientTab.Overview) }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = loaded?.view?.name ?: stringResource(R.string.patient_title),
            subtitle = loaded?.view?.let { header(it) },
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
        )
        if (loaded != null) {
            SkTabs(
                titles = PatientTab.entries.map { stringResource(it.title) },
                selectedIndex = tab.ordinal,
                onSelect = { tab = PatientTab.entries[it] },
            )
        }
        Box(Modifier.weight(1f).navigationBarsPadding()) {
            if (loaded == null || tab == PatientTab.Overview) OverviewTab(state, holder) else tabContent(tab)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OverviewTab(
    state: Patient360State,
    holder: Patient360StateHolder,
) {
    PullToRefreshBox(
        isRefreshing = (state as? Patient360State.Loaded)?.refreshing == true,
        onRefresh = holder::refresh,
        modifier = Modifier.fillMaxSize(),
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

            is Patient360State.Loaded -> {
                Overview(state)
            }
        }
    }
}

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
