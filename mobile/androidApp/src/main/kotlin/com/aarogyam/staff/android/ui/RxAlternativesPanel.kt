package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.prescriptions.AlternativesState
import com.aarogyam.staff.prescriptions.DrugView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkDivider
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The alternatives of one medicine line: loading, the list (tap one to swap), none, or an error. */
@Composable
internal fun RxAlternativesPanel(
    state: AlternativesState,
    onSwap: (DrugView) -> Unit,
) {
    Column(Modifier.padding(top = Spacing.S.dp)) {
        when {
            state.loading -> {
                Note(stringResource(R.string.rx_alt_loading))
            }

            state.error != null -> {
                Note(stringResource(state.error!!.message()), SkTheme.colors.dangerText.color)
            }

            state.items.isEmpty() -> {
                Note(stringResource(R.string.rx_alt_none))
            }

            else -> {
                state.items.forEach { drug ->
                    SkListRow(
                        title = listOfNotNull(drug.brand, drug.name).first(),
                        subtitle =
                            listOfNotNull(
                                drug.name.takeIf { drug.brand != null },
                                drug.strength,
                                drug.form,
                            ).joinToString(" · "),
                        onClick = { onSwap(drug) },
                    )
                    SkDivider()
                }
            }
        }
    }
}

@Composable
private fun Note(
    text: String,
    color: androidx.compose.ui.graphics.Color = SkTheme.colors.textMuted.color,
) = Text(text, style = SkTypography.footnote, color = color, modifier = Modifier.padding(vertical = 4.dp))
