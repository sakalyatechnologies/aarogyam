package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.today.CycleLogHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** "Log a cycle": a cycle that ran now with an optional note on the load, above today's cycles. */
@Composable
fun CycleSheet(
    holder: CycleLogHolder,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    var note by rememberSaveable { mutableStateOf("") }
    val colors = SkTheme.colors
    LaunchedEffect(holder) { holder.load() }
    SkBottomSheet(title = stringResource(R.string.v7_cycle_title), onDismiss = onDismiss) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            SkTextField(note, { note = it.take(NOTE_MAX) }, stringResource(R.string.v7_cycle_note))
            state.error?.let {
                Text(stringResource(it.message()), style = SkTypography.footnote, color = colors.dangerText.color)
            }
            SkButton(
                stringResource(R.string.v7_cycle_save),
                {
                    holder.record(note)
                    note = ""
                },
                Modifier.fillMaxWidth(),
                enabled = !state.saving,
            )
            if (state.cycles.isEmpty() && !state.loading) {
                Text(
                    stringResource(R.string.v7_cycle_none),
                    style = SkTypography.footnote,
                    color = colors.textMuted.color,
                )
            }
            state.cycles.forEach { cycle ->
                val line = listOfNotNull(cycle.ranAt?.short(), cycle.loadNote, cycle.recordedBy).joinToString(" · ")
                Text(line, style = SkTypography.bodyText, color = colors.text.color)
            }
        }
    }
}

private const val NOTE_MAX = 120
