package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.today.MoneyView
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Collected today and Expenses today (owner and finance only), with "+ Add expense". */
@Composable
fun MoneyCards(
    money: MoneyView,
    onAddExpense: (() -> Unit)?,
) {
    val p = SkTheme.palette
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SkCard(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.v7_money_collected),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
            Text(
                money.collectedPaise.rupees(),
                style = SkTypography.number.copy(fontSize = 16.sp),
                color = p.onSurface.color,
            )
            Text(
                stringResource(R.string.v7_money_dues, money.pendingDuesPaise.rupees()),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
        }
        SkCard(
            Modifier.weight(1f).then(
                if (onAddExpense !=
                    null
                ) {
                    Modifier.clickable(role = Role.Button, onClick = onAddExpense)
                } else {
                    Modifier
                },
            ),
        ) {
            Text(
                stringResource(R.string.v7_money_expenses),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
            Text(
                money.expensesTodayPaise?.rupees() ?: "—",
                style = SkTypography.number.copy(fontSize = 16.sp),
                color = p.onSurface.color,
            )
            if (onAddExpense !=
                null
            ) {
                Text(
                    stringResource(R.string.v7_money_add_expense),
                    style = SkTypography.caption.copy(fontWeight = FontWeight.Bold),
                    color = p.primary.color,
                )
            }
        }
    }
}
