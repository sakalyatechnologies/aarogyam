package com.aarogyam.staff.android.ui.more

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.team.StockRow
import com.aarogyam.staff.team.StockStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The low-stock page (iOS `StockPage`). */
@Composable
fun StockPage(
    holder: StockStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    Column(Modifier.fillMaxSize()) {
        SkCollapsingTopBar(
            stringResource(R.string.v7_tile_stock),
            collapsed = false,
            navigation = { BarAction(stringResource(R.string.back), p.primary.color, onBack) },
        )
        when (val s = state) {
            ListState.Loading -> {
                LoadingIndicator()
            }

            ListState.NotAllowed -> {
                SkEmptyState(
                    stringResource(R.string.today_not_allowed_title),
                    stringResource(R.string.today_not_allowed_message),
                )
            }

            is ListState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.v7_tile_stock),
                    stringResource(s.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::refresh,
                )
            }

            is ListState.Loaded -> {
                if (s.items.isEmpty()) {
                    SkEmptyState(
                        stringResource(R.string.sh_v7_stock_empty_title),
                        stringResource(R.string.sh_v7_stock_empty_message),
                    )
                } else {
                    Column(
                        Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp),
                        verticalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        s.items.forEachIndexed { i, row -> StockLine(row, i, s.items.lastIndex) }
                    }
                }
            }
        }
    }
}

@Composable
private fun StockLine(
    row: StockRow,
    index: Int,
    last: Int,
) {
    val p = SkTheme.palette
    val top = if (index == 0) BIG else SMALL
    val bottom = if (index == last) BIG else SMALL
    Row(
        Modifier
            .fillMaxWidth()
            .background(p.surface1.color, RoundedCornerShape(top.dp, top.dp, bottom.dp, bottom.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SkIcon(Icons.of("box"), if (row.critical) p.error.color else p.onSurfaceVariant.color, size = 19.dp)
        Column(Modifier.weight(1f)) {
            Text(row.name, style = SkTypography.bodyStrong, color = p.onSurface.color)
            Text(
                stringResource(R.string.sh_v7_stock_on_hand, row.onHand, row.unit, row.reorderLevel),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
        }
        SkChip(
            stringResource(if (row.critical) R.string.sh_v7_stock_critical else R.string.sh_v7_stock_low),
            tone = if (row.critical) SkTone.Danger else SkTone.Warning,
        )
    }
}

private const val BIG = 22
private const val SMALL = 8
