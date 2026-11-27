package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sakalya.mobile.design.SheetSizes
import com.sakalya.mobile.designcompose.SkSheetHeader
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The v7 modal sheet with two additions over `SkModalSheet`: a [footer] pinned under the scrolling content (so a
 * primary action never leaves the screen), and [partial], which opens at half height with a drag up to full.
 * With [scrolls] false the [content] scrolls itself.
 */
@OptIn(ExperimentalMaterial3Api::class) // ModalBottomSheet's state API is still marked experimental.
@Composable
fun PinnedSheet(
    title: String,
    onDismiss: () -> Unit,
    subtitle: String? = null,
    partial: Boolean = false,
    scrolls: Boolean = true,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val p = SkTheme.palette
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = !partial),
        shape = RoundedCornerShape(topStart = SheetSizes.RADIUS.dp, topEnd = SheetSizes.RADIUS.dp),
        containerColor = p.sheet.color,
        scrimColor = Color.Black.copy(alpha = SheetSizes.SCRIM_ALPHA.toFloat()),
        dragHandle = {
            Box(
                Modifier
                    .padding(top = SheetSizes.PADDING_TOP.dp, bottom = SheetSizes.GRAB_GAP.dp)
                    .size(SheetSizes.GRAB_WIDTH.dp, SheetSizes.GRAB_HEIGHT.dp)
                    .background(p.outline.color, RoundedCornerShape(SheetSizes.GRAB_RADIUS.dp)),
            )
        },
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
            val body = Modifier.weight(1f, fill = false).fillMaxWidth()
            Column(
                if (scrolls) body.verticalScroll(rememberScrollState()) else body,
                verticalArrangement = Arrangement.spacedBy(SheetSizes.GAP.dp),
                horizontalAlignment = Alignment.Start,
            ) {
                SkSheetHeader(title, Modifier.padding(horizontal = SheetSizes.PADDING_H.dp), subtitle = subtitle)
                Column(
                    Modifier.padding(horizontal = SheetSizes.PADDING_H.dp),
                    verticalArrangement = Arrangement.spacedBy(SheetSizes.GAP.dp),
                    content = content,
                )
            }
            if (footer != null) {
                Column(
                    Modifier.padding(horizontal = SheetSizes.PADDING_H.dp).padding(top = 10.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    content = footer,
                )
            }
        }
    }
}
