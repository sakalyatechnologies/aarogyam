package com.aarogyam.patient.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.aarogyam.patient.android.R
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** A screen: the brand top bar (with Back when [onBack]), then a scrolling list of cards. */
@Composable
fun PatientScreen(
    title: String,
    onBack: (() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: LazyListScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        SkTopBar(
            title,
            subtitle = subtitle,
            navigation =
                onBack?.let { back ->
                    { BarAction(stringResource(R.string.back), SkTheme.colors.onPrimary.color, back) }
                },
            actions = actions,
        )
        LazyColumn(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.navigationBars),
            contentPadding = PaddingValues(Spacing.L.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
            content = content,
        )
    }
}

/** A small section heading inside a screen. */
@Composable
fun SectionTitle(text: String) = Text(text, style = SkTypography.overline, color = SkTheme.colors.textMuted.color)

/** Body text in the theme's colour; [muted] for secondary lines. */
@Composable
fun BodyText(
    text: String,
    muted: Boolean = false,
) = Text(
    text,
    style = SkTypography.bodyText,
    color = if (muted) SkTheme.colors.textMuted.color else SkTheme.colors.text.color,
)

/** A text action in a top bar, at least the minimum touch target. */
@Composable
fun BarAction(
    text: String,
    color: Color,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .sizeIn(minWidth = Spacing.MIN_TOUCH_TARGET.dp, minHeight = Spacing.MIN_TOUCH_TARGET.dp)
            .clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = SkTypography.label, color = color)
    }
}
