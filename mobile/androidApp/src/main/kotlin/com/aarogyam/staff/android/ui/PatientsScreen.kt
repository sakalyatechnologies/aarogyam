package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.PatientFilter
import com.aarogyam.staff.android.ui.patient.PillKind
import com.aarogyam.staff.android.ui.patient.V7Card
import com.aarogyam.staff.android.ui.patient.V7Icon
import com.aarogyam.staff.android.ui.patient.V7Pill
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.today.InitialsAvatar
import com.aarogyam.staff.patients.PatientRow
import com.aarogyam.staff.patients.PatientsState
import com.aarogyam.staff.patients.PatientsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

@Composable
private fun PatientFilter.title(): String =
    stringResource(
        when (this) {
            PatientFilter.All -> R.string.pv_filter_all
            PatientFilter.Dues -> R.string.pv_filter_dues
            PatientFilter.Recalls -> R.string.pv_filter_recalls
            PatientFilter.New -> R.string.pv_filter_new
        },
    )

/** Search-as-you-type over the clinic's patients, filter chips, and a grouped list with a due pill; a tap opens the patient page. */
@Composable
fun PatientsScreen(
    holder: PatientsStateHolder,
    onOpen: (String) -> Unit,
    onWalkIn: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(PatientFilter.All) }
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
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.ML.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PatientFilter.entries.forEach { item ->
                        SkChoiceChip(item.title(), filter == item, { filter = item })
                    }
                }
                if (filter.needsServer) {
                    V7Pill(stringResource(R.string.p9_preview), PillKind.Warm, Modifier.padding(Spacing.ML.dp))
                }
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
                        Results(current, filter, onOpen)
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
    filter: PatientFilter,
    onOpen: (String) -> Unit,
) {
    val rows = if (filter == PatientFilter.Recalls) state.items.filter { it.recallDue } else state.items
    if (rows.isEmpty()) {
        val text =
            when {
                state.query.isNotBlank() -> R.string.pv_patients_empty_search
                filter == PatientFilter.Recalls -> R.string.pv_patients_empty_recalls
                else -> R.string.pv_patients_empty_none
            }
        Column(Modifier.padding(Spacing.ML.dp)) {
            V7Card { Text(stringResource(text), style = v7(13f), color = SkTheme.palette.onSurfaceVariant.color) }
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding =
            androidx.compose.foundation.layout.PaddingValues(
                horizontal = Spacing.ML.dp,
                vertical = Spacing.S.dp,
            ),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        itemsIndexed(rows, key = { _, row -> row.id }) { index, row -> PatientListRow(row, index, rows.size, onOpen) }
    }
}

/** One patient: initials, name, `file · age sex`, and a recall pill or the chevron, on a grouped surface rounded at the outer ends. */
@Composable
private fun PatientListRow(
    row: PatientRow,
    index: Int,
    count: Int,
    onOpen: (String) -> Unit,
) {
    val p = SkTheme.palette
    val sex = row.sex.label()?.let { stringResource(it) }
    val age = row.ageYears?.let { stringResource(R.string.age_years, it) }
    val big = 20.dp
    val small = 6.dp
    val shape =
        RoundedCornerShape(
            topStart = if (index == 0) big else small,
            topEnd = if (index == 0) big else small,
            bottomStart = if (index == count - 1) big else small,
            bottomEnd = if (index == count - 1) big else small,
        )
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.card.color, shape)
            .clickable(role = Role.Button) { onOpen(row.id) }
            .padding(vertical = 10.dp, horizontal = 12.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        InitialsAvatar(row.name, 36.dp, cool = index % 2 == 1)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(row.name, style = v7(13.5f, FontWeight.Bold), color = p.onSurface.color)
            Text(
                listOfNotNull(row.number, age, sex).joinToString(" · "),
                style = v7(11.5f),
                color = p.onSurfaceVariant.color,
            )
        }
        if (row.recallDue) {
            V7Pill(
                stringResource(R.string.pv_patients_recall),
                PillKind.Warm,
            )
        } else {
            V7Icon("chev", p.onSurfaceVariant.color, 18.dp)
        }
    }
}
