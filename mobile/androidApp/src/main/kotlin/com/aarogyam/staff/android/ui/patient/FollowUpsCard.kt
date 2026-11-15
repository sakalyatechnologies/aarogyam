package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.visit.RecallView
import com.aarogyam.staff.visit.RecallsState
import com.aarogyam.staff.visit.RecallsStateHolder
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color
import kotlinx.datetime.LocalDate

/**
 * The patient's open follow-ups on Overview: due date and reason, with Dismiss for one that is no
 * longer needed (after a confirm). Hidden when there are none.
 */
@Composable
internal fun FollowUpsCard(
    holder: RecallsStateHolder,
    state: RecallsState,
    canDismiss: Boolean,
) {
    if (!state.allowed || (state.items.isEmpty() && state.error == null)) return
    var dismissing by remember { mutableStateOf<RecallView?>(null) }
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(
                stringResource(R.string.p9_followups),
                state.items
                    .takeIf { it.isNotEmpty() }
                    ?.size
                    ?.toString(),
            )
            state.error?.let { ErrorLine(it) }
            state.items.forEach { item -> FollowUpRow(item, canDismiss) { dismissing = item } }
        }
    }
    dismissing?.let { item ->
        AlertDialog(
            onDismissRequest = { dismissing = null },
            title = { Text(stringResource(R.string.p9_followups_dismiss_confirm)) },
            confirmButton = {
                TextButton({
                    holder.dismiss(item.id, null)
                    dismissing = null
                }) { Text(stringResource(R.string.p9_followups_dismiss), color = SkTheme.palette.error.color) }
            },
            dismissButton = { TextButton({ dismissing = null }) { Text(stringResource(R.string.p9_cancel)) } },
        )
    }
}

@Composable
private fun FollowUpRow(
    item: RecallView,
    canDismiss: Boolean,
    onDismiss: () -> Unit,
) {
    val p = SkTheme.palette
    val due = runCatching { LocalDate.parse(item.dueOn).display() }.getOrDefault(item.dueOn)
    Row(
        Modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.p9_followups_due, due), style = v7(12f), color = p.onSurfaceVariant.color)
            Text(item.reason, style = v7(14f, FontWeight.SemiBold), color = p.onSurface.color)
        }
        if (canDismiss) {
            val description = stringResource(R.string.p9_followups_dismiss_a11y, due)
            SkPillButton(
                stringResource(R.string.p9_followups_dismiss),
                onDismiss,
                modifier = Modifier.semantics { contentDescription = description },
                variant = SkPillVariant.Ghost,
            )
        }
    }
}
