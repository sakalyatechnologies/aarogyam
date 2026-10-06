package com.aarogyam.staff.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

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

/** A centred progress indicator, announced as loading. */
@Composable
fun LoadingIndicator() {
    val label = stringResource(R.string.loading)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(
            Modifier.semantics { contentDescription = label },
            color = SkTheme.colors.primary.color,
        )
    }
}
