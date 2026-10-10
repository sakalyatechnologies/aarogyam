package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.designcompose.SkBadgeDot
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The mockup's `--mono` times ("10:45"). */
internal val Mono = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold, fontSize = 11.sp)

/** A round 36 dp icon button on the tonal well (`.and .iconbtn`), with an optional unread dot. */
@Composable
internal fun IconWell(
    icon: String,
    description: String,
    onClick: () -> Unit,
    badge: Boolean = false,
    tint: Color = SkTheme.palette.onSurface.color,
    background: Color = SkTheme.palette.surface2.color,
) {
    Box(
        Modifier
            .size(ICON_WELL.dp)
            .background(background, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        SkIcon(Icons.of(icon), tint, size = ICON.dp)
        if (badge) BadgeCorner()
    }
}

@Composable
private fun BoxScope.BadgeCorner() {
    SkBadgeDot(Modifier.align(Alignment.TopEnd).padding(top = BADGE_TOP.dp, end = BADGE_END.dp))
}

private const val ICON_WELL = 36
private const val ICON = 19
private const val BADGE_TOP = 6
private const val BADGE_END = 7

/** Hours and minutes in 12-hour clinic style, "10:45". */
internal fun kotlinx.datetime.LocalTime.short(): String {
    val h = if (hour % 12 == 0) 12 else hour % 12
    return "$h:${minute.toString().padStart(2, '0')}"
}
