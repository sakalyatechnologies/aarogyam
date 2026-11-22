package com.aarogyam.staff.android.ui.glass

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.tone

/*
 * Direction A, "Clear Glass, calm clinical", in Material terms. Content sits in inset grouped surfaces (solid card
 * rows, 20 dp at the group's ends and 4 dp joins); translucency stays on chrome (sheet headers and bars) only.
 */

/** The corners of row [index] of [count] in an inset group: round at the group's ends, tight at the joins. */
fun groupShape(
    index: Int,
    count: Int,
): Shape {
    val top = if (index == 0) GROUP_END.dp else GROUP_JOIN.dp
    val bottom = if (index == count - 1) GROUP_END.dp else GROUP_JOIN.dp
    return RoundedCornerShape(top, top, bottom, bottom)
}

/** One row of an inset group: a solid card surface, at least 56 dp tall, a button when [onClick] is set. */
@Composable
fun GroupRow(
    index: Int,
    count: Int,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = ROW_MIN.dp)
            .background(SkTheme.palette.card.color, groupShape(index, count))
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = ROW_H.dp, vertical = ROW_V.dp),
        horizontalArrangement = Arrangement.spacedBy(ROW_GAP.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/**
 * A Settings-style field row in an inset group (Clear Glass form): the label on the left, the value typed on the
 * right, 56 dp tall. The whole row focuses the field.
 */
@Composable
fun GroupField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    index: Int,
    count: Int,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    val p = SkTheme.palette
    val style = SkTypography.bodyText.copy(color = p.onSurface.color)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        textStyle = style,
        singleLine = true,
        cursorBrush = SolidColor(p.primary.color),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        decorationBox = { inner ->
            GroupRow(index, count) {
                Text(
                    label,
                    Modifier.widthIn(min = LABEL_MIN.dp, max = LABEL_MAX.dp),
                    style = SkTypography.bodyText,
                    color = p.onSurfaceVariant.color,
                )
                Box(Modifier.weight(1f)) { inner() }
            }
        },
    )
}

/** The small muted heading above a group ("Today", "2 people on this number"). */
@Composable
fun GroupHeader(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        style = SkTypography.footnote.copy(fontWeight = FontWeight.SemiBold, fontSize = HEADER_SIZE.sp),
        color = SkTheme.palette.onSurfaceVariant.color,
        modifier =
            modifier
                .fillMaxWidth()
                .padding(start = HEADER_START.dp, top = HEADER_TOP.dp, bottom = HEADER_BOTTOM.dp)
                .semantics { heading() },
    )
}

/** A rounded tile tinted by [tone] holding an art icon: the kind marker of a notification or an attention row. */
@Composable
fun KindTile(
    icon: String,
    tone: SkTone,
    size: Dp = TILE.dp,
) {
    val colors = SkTheme.colors.tone(tone)
    Box(
        Modifier.size(size).background(colors.soft.color, RoundedCornerShape(TILE_RADIUS.dp)),
        contentAlignment = Alignment.Center,
    ) {
        SkIcon(Icons.of(icon), colors.text.color, size = (size.value * ICON_RATIO).dp)
    }
}

/**
 * The chrome fill behind sticky headers and bars: [color] slightly see-through on Android 12+ (where the platform
 * draws translucent surfaces smoothly), solid below. Never used on list rows.
 */
fun Modifier.glassChrome(color: Color): Modifier =
    background(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) color.copy(alpha = CHROME_ALPHA) else color)

private const val GROUP_END = 20
private const val GROUP_JOIN = 4

/** The gap between joined rows of one group. */
val GroupGap: Dp = 2.dp

private const val ROW_MIN = 56
private const val ROW_H = 14
private const val ROW_V = 10
private const val ROW_GAP = 12
private const val HEADER_SIZE = 13
private const val HEADER_START = 6
private const val HEADER_TOP = 16
private const val HEADER_BOTTOM = 6
private const val TILE = 40
private const val TILE_RADIUS = 12
private const val ICON_RATIO = 0.5f
private const val CHROME_ALPHA = 0.9f
private const val LABEL_MIN = 72
private const val LABEL_MAX = 120
