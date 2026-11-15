package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The mockup's point size and weight on the kit's body face. */
internal fun v7(
    size: Float,
    weight: FontWeight = FontWeight.Normal,
): TextStyle = SkTypography.bodyText.copy(fontSize = size.sp, fontWeight = weight, lineHeight = (size * LINE).sp)

private const val LINE = 1.3f

/** The mockup's `.card`: card colour, 20 dp corners, 14 dp padding; a button when [onClick] is set. */
@Composable
internal fun V7Card(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(CARD_RADIUS.dp)
    Column(
        modifier
            .fillMaxWidth()
            .background(SkTheme.palette.card.color, shape)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(CARD_PADDING.dp),
        content = content,
    )
}

private const val CARD_RADIUS = 20
private const val CARD_PADDING = 14

/** A muted line of copy. */
@Composable
internal fun V7Muted(
    text: String,
    modifier: Modifier = Modifier,
) = Text(text, style = v7(MUTED_SIZE), color = SkTheme.palette.onSurfaceVariant.color, modifier = modifier)

private const val MUTED_SIZE = 12.5f

/** A small bold label above a group of choices. */
@Composable
internal fun V7Label(text: String) =
    Text(
        text.uppercase(),
        style = v7(LABEL_SIZE, FontWeight.ExtraBold).copy(letterSpacing = 0.4.sp),
        color = SkTheme.palette.onSurfaceVariant.color,
        modifier = Modifier.padding(top = 4.dp),
    )

private const val LABEL_SIZE = 11f

/** The tone of a [V7Pill]. */
internal enum class PillKind { Warm, Done, Error, Neutral }

/** The mockup's `.pill`: small, heavy, uppercase and tonal. */
@Composable
internal fun V7Pill(
    text: String,
    kind: PillKind,
    modifier: Modifier = Modifier,
) {
    val p = SkTheme.palette
    val (fill, ink) =
        when (kind) {
            PillKind.Warm -> p.tertiaryContainer to p.onTertiaryContainer
            PillKind.Done -> p.primaryContainer to p.onPrimaryContainer
            PillKind.Error -> p.errorContainer to p.onErrorContainer
            PillKind.Neutral -> p.surface3 to p.onSurfaceVariant
        }
    Text(
        text.uppercase(),
        style = v7(PILL_SIZE, FontWeight.ExtraBold).copy(letterSpacing = 0.4.sp),
        color = ink.color,
        maxLines = 1,
        modifier = modifier.background(fill.color, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

private const val PILL_SIZE = 9.5f

/** A v7 line icon by name (`chev`, `tooth`, `cam`, ...). */
@Composable
internal fun V7Icon(
    name: String,
    tint: Color,
    size: Dp = 20.dp,
) = SkIcon(PatientIcons.of(name), tint, size = size)

/** A card section title with a muted note on the right (the mockup's `.sech`). */
@Composable
internal fun SectionHead(
    title: String,
    note: String? = null,
) {
    Row(
        Modifier.fillMaxWidth().semantics { heading() },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            title,
            style = v7(SECTION_SIZE, FontWeight.ExtraBold),
            color = SkTheme.palette.onSurface.color,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (note != null) {
            Text(
                note,
                style = v7(NOTE_SIZE),
                color = SkTheme.palette.onSurfaceVariant.color,
                textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private const val SECTION_SIZE = 15f
private const val NOTE_SIZE = 12f

/** The inline error line shown above content that stayed on screen after a failed refresh. */
@Composable
internal fun ErrorLine(error: ScreenError) =
    Text(
        stringResource(if (error == ScreenError.Offline) R.string.p9_offline_stale else error.message()),
        style = v7(MUTED_SIZE),
        color = SkTheme.palette.error.color,
        modifier = Modifier.fillMaxWidth(),
    )

/** The designed state of a section that is loading, not allowed or failed. */
internal sealed interface SectionKind {
    data object Loading : SectionKind

    data object NotAllowed : SectionKind

    data class Failed(
        val error: ScreenError,
    ) : SectionKind
}

@Composable
internal fun SectionState(
    title: String,
    kind: SectionKind,
    retry: (() -> Unit)? = null,
) {
    when (kind) {
        SectionKind.Loading -> {
            Box(Modifier.fillMaxWidth().padding(vertical = 32.dp), contentAlignment = Alignment.Center) {
                SkLoadingIndicator(stringResource(R.string.loading))
            }
        }

        SectionKind.NotAllowed -> {
            SkEmptyState(title, stringResource(R.string.p9_not_allowed))
        }

        is SectionKind.Failed -> {
            SkEmptyState(
                title,
                stringResource(if (kind.error == ScreenError.Offline) R.string.p9_offline else kind.error.message()),
                actionLabel = stringResource(R.string.try_again),
                onAction = retry,
            )
        }
    }
}

/** A round badge with a short label (a tooth number, a check). */
@Composable
internal fun Round(
    text: String,
    tonal: Boolean = true,
) {
    val p = SkTheme.palette
    Box(
        Modifier
            .size(ROUND.dp)
            .background((if (tonal) p.primaryContainer else p.surface3).color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = v7(ROUND_TEXT, FontWeight.ExtraBold),
            color = (if (tonal) p.onPrimaryContainer else p.onSurfaceVariant).color,
        )
    }
}

private const val ROUND = 38
private const val ROUND_TEXT = 13f

/** Wraps its children onto new lines, as the mockup's `flex-wrap`. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Flow(
    modifier: Modifier = Modifier,
    spacing: Dp = 6.dp,
    content: @Composable FlowRowScope.() -> Unit,
) = FlowRow(modifier, Arrangement.spacedBy(spacing), Arrangement.spacedBy(spacing), content = content)

/** A pressable pill used for actions on a tonal background. */
@Composable
internal fun TextPill(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val p = SkTheme.palette
    Box(
        modifier
            .defaultMinSize(minHeight = 44.dp)
            .background(p.surface2.color, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = v7(12f, FontWeight.Bold), color = p.primary.color) }
}
