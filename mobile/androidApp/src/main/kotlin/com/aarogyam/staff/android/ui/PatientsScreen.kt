package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.patients.PatientRow
import com.aarogyam.staff.patients.PatientsState
import com.aarogyam.staff.patients.PatientsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatar
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/** Search-as-you-type over the clinic's patients; a tap opens Patient 360. */
@Composable
fun PatientsScreen(
    holder: PatientsStateHolder,
    onOpen: (String) -> Unit,
    onWalkIn: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().imePadding()) {
        SkTopBar(
            title = stringResource(R.string.patients_title),
            actions = { BarAction(stringResource(R.string.walk_in_add), SkTheme.colors.onBrandDark.color, onWalkIn) },
        )
        when (val current = state) {
            PatientsState.NotAllowed -> {
                SkEmptyState(
                    stringResource(R.string.patients_not_allowed_title),
                    stringResource(R.string.patients_not_allowed_message),
                )
            }

            else -> {
                SkSearchField(
                    query = current.queryText(),
                    onQueryChange = holder::search,
                    placeholder = stringResource(R.string.patients_search),
                    modifier = Modifier.padding(horizontal = Spacing.ML.dp, vertical = Spacing.M.dp),
                )
                when (current) {
                    is PatientsState.Loading -> {
                        LoadingIndicator()
                    }

                    is PatientsState.Failed -> {
                        SkEmptyState(
                            stringResource(R.string.patients_title),
                            stringResource(current.error.message()),
                            actionLabel = stringResource(R.string.try_again),
                            onAction = holder::retry,
                        )
                    }

                    is PatientsState.Loaded -> {
                        Results(current, onOpen)
                    }

                    PatientsState.NotAllowed -> {}
                }
            }
        }
    }
}

private fun PatientsState.queryText(): String =
    when (this) {
        PatientsState.NotAllowed -> ""
        is PatientsState.Loading -> query
        is PatientsState.Failed -> query
        is PatientsState.Loaded -> query
    }

@Composable
private fun Results(
    state: PatientsState.Loaded,
    onOpen: (String) -> Unit,
) {
    if (state.items.isEmpty()) {
        val searched = state.query.isNotBlank()
        SkEmptyState(
            stringResource(if (searched) R.string.patients_empty_title else R.string.patients_none_title),
            stringResource(if (searched) R.string.patients_empty_message else R.string.patients_none_message),
        )
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Spacing.ML.dp, vertical = Spacing.S.dp),
    ) {
        item {
            SkCard(contentPadding = 0.dp) {
                state.items.forEachIndexed { index, row ->
                    if (index > 0) SkDivider()
                    PatientRowView(row, onOpen)
                }
            }
        }
    }
}

@Composable
private fun PatientRowView(
    row: PatientRow,
    onOpen: (String) -> Unit,
) {
    val sex = row.sex.label()?.let { stringResource(it) }
    val age = row.ageYears?.let { stringResource(R.string.age_years, it) }
    SkListRow(
        title = row.name,
        subtitle = listOfNotNull(row.number, age, sex).joinToString(" · "),
        onClick = { onOpen(row.id) },
        leading = { SkAvatar(row.name) },
        trailing =
            if (row.recallDue) {
                (
                    {
                        SkChip(
                            stringResource(R.string.recall_due),
                            tone = SkTone.Warning,
                        )
                    }
                )
            } else {
                null
            },
    )
}
