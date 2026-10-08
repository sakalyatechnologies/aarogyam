package com.aarogyam.staff.android.ui.walkin

import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** A one-tap pick in the clinic's brand colours (Material's default selected tint is off-brand). */
@Composable
internal fun PickChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(text) },
        colors =
            FilterChipDefaults.filterChipColors(
                containerColor = colors.card.color,
                labelColor = colors.text.color,
                selectedContainerColor = colors.brandSoft.color,
                selectedLabelColor = colors.primaryText.color,
            ),
    )
}
