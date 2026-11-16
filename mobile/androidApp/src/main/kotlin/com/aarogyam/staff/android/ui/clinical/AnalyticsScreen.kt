package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.analytics.AnalyticsRange
import com.aarogyam.staff.analytics.AnalyticsState
import com.aarogyam.staff.analytics.AnalyticsStateHolder
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.analytics.AnalyticsCards
import com.aarogyam.staff.android.ui.analytics.RangeControls
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/** The Analytics page: range chips, then cards for money, patients, chairs and mix (iOS `AnalyticsScreen`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AnalyticsScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: AnalyticsStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var adding by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title = stringResource(R.string.cn_c_analytics_title),
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
        )
        PullToRefreshBox(isRefreshing = false, onRefresh = holder::refresh, modifier = Modifier.weight(1f)) {
            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(
                        rememberScrollState(),
                    ).padding(horizontal = Spacing.L.dp)
                    .padding(bottom = Spacing.XXL.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                rangeOf(state)?.let { RangeControls(holder, it) }
                when (val current = state) {
                    is AnalyticsState.Loading -> {
                        Box(Modifier.fillMaxWidth().padding(Spacing.XXL.dp)) { LoadingIndicator() }
                    }

                    AnalyticsState.NotAllowed -> {
                        SkEmptyState(
                            stringResource(R.string.an_c_not_allowed_title),
                            stringResource(R.string.an_c_not_allowed_message),
                        )
                    }

                    is AnalyticsState.Failed -> {
                        SkEmptyState(
                            stringResource(R.string.cn_c_analytics_title),
                            stringResource(current.error.message()),
                            actionLabel = stringResource(R.string.try_again),
                            onAction = holder::refresh,
                        )
                    }

                    is AnalyticsState.Loaded -> {
                        if (current.view.isEmpty) {
                            SkEmptyState(
                                stringResource(R.string.an_empty_title),
                                stringResource(R.string.an_empty_message),
                            )
                        } else {
                            AnalyticsCards(
                                current.view,
                                if ("expenses.write" in
                                    clinic.permissions
                                ) {
                                    ({ adding = true })
                                } else {
                                    null
                                },
                            )
                        }
                    }
                }
            }
        }
    }
    if (adding) {
        val expenses = rememberHolder { graph.expenses(clinic, it) }
        ExpenseSheet(expenses, onDismiss = {
            adding = false
            holder.refresh()
        })
    }
}

private fun rangeOf(state: AnalyticsState): AnalyticsRange? =
    when (state) {
        is AnalyticsState.Loading -> state.range
        is AnalyticsState.Failed -> state.range
        is AnalyticsState.Loaded -> state.view.range
        AnalyticsState.NotAllowed -> null
    }
