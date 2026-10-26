package com.aarogyam.staff.android.ui.today

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import com.sakalya.mobile.designcompose.SkAvatarFrame
import com.sakalya.mobile.designcompose.SkAvatarShape
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.initialsOf

/** The mockup's patient "shape": initials on the tertiary container, or the primary container when [cool] (`.shape.g`). */
@Composable
fun InitialsAvatar(
    name: String,
    size: Dp,
    modifier: Modifier = Modifier,
    cool: Boolean = false,
) {
    val p = SkTheme.palette
    val bg = if (cool) p.primaryContainer else p.tertiaryContainer
    val ink = if (cool) p.onPrimaryContainer else p.onTertiaryContainer
    SkAvatarFrame(SkAvatarShape.Cookie, size, bg.color, modifier.clearAndSetSemantics { contentDescription = name }) {
        Text(
            initialsOf(name),
            style =
                SkTypography.caption.copy(
                    fontWeight = FontWeight.ExtraBold,
                    fontSize =
                        (
                            size.value *
                                INITIALS
                        ).sp,
                ),
            color = ink.color,
        )
    }
}

/** "2:00 pm" in the phone's locale, for times shown in a sentence. */
fun kotlinx.datetime.LocalTime.clock(locale: java.util.Locale): String =
    java.time.LocalTime
        .of(
            hour,
            minute,
        ).format(
            java.time.format.DateTimeFormatter
                .ofPattern("h:mm a", locale),
        ).lowercase(locale)

private const val INITIALS = 0.31f
