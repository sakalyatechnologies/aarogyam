package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** A one-tap pick in the clinic's brand colours. */
@Composable
internal fun VisitChip(
    text: String,
    selected: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    FilterChip(
        selected = selected,
        onClick = onClick,
        enabled = enabled,
        label = { Text(text) },
        colors =
            FilterChipDefaults.filterChipColors(
                containerColor = colors.inset.color,
                labelColor = colors.text.color,
                selectedContainerColor = colors.brandSoft.color,
                selectedLabelColor = colors.primaryText.color,
            ),
    )
}

/** A round button with a glyph, at least the minimum touch target. */
@Composable
internal fun RoundGlyph(
    glyph: String,
    description: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .sizeIn(minWidth = Spacing.MIN_TOUCH_TARGET.dp, minHeight = Spacing.MIN_TOUCH_TARGET.dp)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(GLYPH_SIZE.dp).clip(CircleShape).background(SkTheme.colors.inset.color),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                glyph,
                style = SkTypography.bodyStrong,
                color = SkTheme.colors.text.color,
                modifier =
                    Modifier
                        .clearAndSetSemantics {
                        },
            )
        }
    }
}

/** A tappable capsule well (a medicine or procedure suggestion). */
@Composable
internal fun WellChip(
    text: String,
    description: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .sizeIn(minHeight = Spacing.MIN_TOUCH_TARGET.dp)
            .clip(RoundedCornerShape(CAPSULE.dp))
            .background(SkTheme.colors.inset.color)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.ML.dp)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = SkTypography.callout, color = SkTheme.colors.text.color, maxLines = 1)
    }
}

@Composable
internal fun Muted(
    text: String,
    modifier: Modifier = Modifier,
) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color, modifier = modifier)

@Composable
internal fun ErrorLine(
    text: String,
    modifier: Modifier = Modifier,
) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.dangerText.color, modifier = modifier)

@Composable
internal fun SectionTitle(
    text: String,
    modifier: Modifier = Modifier,
) = Text(text, style = SkTypography.headline, color = SkTheme.colors.text.color, modifier = modifier)

private const val GLYPH_SIZE = 36
private const val CAPSULE = 999
