package com.aarogyam.staff.android.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.today.AttentionKind
import com.aarogyam.staff.today.AttentionView
import com.aarogyam.staff.today.ScheduleItem
import com.aarogyam.staff.today.VisitStatus
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** A section heading with an optional action on the right (`.sec-h`). */
@Composable
fun SectionHeader(
    title: String,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 2.dp, end = 2.dp, top = 16.dp, bottom = 7.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            title,
            style =
                SkTypography.titleSmall.copy(
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 14.5.sp,
                ),
            color = SkTheme.palette.onSurface.color,
            modifier =
                Modifier.weight(1f).semantics {
                    heading()
                },
        )
        if (action != null) {
            Text(
                action,
                style = SkTypography.callout.copy(fontWeight = FontWeight.Bold),
                color = SkTheme.palette.primary.color,
                modifier = Modifier.clickable(role = Role.Button, onClick = onAction).padding(4.dp),
            )
        }
    }
}

/** The "Up next" carousel: the first card wider and tinted (`.car`). */
@Composable
fun UpNextCarousel(
    items: List<ScheduleItem>,
    onOpen: (ScheduleItem) -> Unit,
) {
    val p = SkTheme.palette
    LazyRow(contentPadding = PaddingValues(horizontal = SIDE.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(items, key = { _, it -> it.appointmentId }) { i, item ->
            val first = i == 0
            Column(
                Modifier
                    .width(if (first) FIRST.dp else CARD.dp)
                    .background(
                        if (first) p.primaryContainer.color else p.surface1.color,
                        RoundedCornerShape(CAR_RADIUS.dp),
                    ).clickable(role = Role.Button) { onOpen(item) }
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                InitialsAvatar(item.patientName, CAR_AVATAR.dp, cool = i % 2 == 1)
                val ink = if (first) p.onPrimaryContainer.color else p.onSurface.color
                Text(
                    item.patientName,
                    style = SkTypography.bodyStrong.copy(fontSize = 12.5.sp),
                    color = ink,
                    maxLines = 1,
                )
                Text(
                    listOfNotNull(item.starts.short(), item.reason).joinToString(" · "),
                    style = SkTypography.caption,
                    color = ink.copy(alpha = 0.8f),
                    maxLines = 2,
                )
            }
        }
    }
}

/** The day's schedule as a joined list with times and status pills. */
@Composable
fun ScheduleList(
    items: List<ScheduleItem>,
    onOpen: (ScheduleItem) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, item ->
            ListRow(i, items.size, { onOpen(item) }) {
                Text(
                    item.starts.short(),
                    style = Mono.copy(fontSize = 11.5.sp),
                    color = SkTheme.palette.onSurfaceVariant.color,
                    modifier = Modifier.widthIn(min = 42.dp),
                )
                Column(Modifier.weight(1f)) {
                    Text(
                        item.patientName,
                        style = SkTypography.bodyStrong,
                        color = SkTheme.palette.onSurface.color,
                        maxLines = 1,
                    )
                    item.reason?.let {
                        Text(
                            it,
                            style = SkTypography.caption.copy(fontSize = 11.5.sp),
                            color = SkTheme.palette.onSurfaceVariant.color,
                            maxLines = 1,
                        )
                    }
                }
                StatusPill(item.status)
            }
        }
    }
}

/** Late arrivals and long waits. */
@Composable
fun AttentionList(
    items: List<AttentionView>,
    onOpen: (AttentionView) -> Unit,
) {
    val p = SkTheme.palette
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, item ->
            ListRow(i, items.size, { onOpen(item) }) {
                Box(
                    Modifier.size(LIST_SHAPE.dp).background(p.errorContainer.color, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("!", style = SkTypography.label, color = p.onErrorContainer.color)
                }
                Column(Modifier.weight(1f)) {
                    val title =
                        when (item.kind) {
                            AttentionKind.LateArrival -> stringResource(R.string.v7_attention_late, item.minutes)
                            AttentionKind.LongWait -> stringResource(R.string.v7_attention_wait, item.minutes)
                            AttentionKind.Other -> stringResource(R.string.v7_attention_other)
                        }
                    Text(title, style = SkTypography.bodyStrong, color = p.onSurface.color)
                    Text(
                        item.patientName,
                        style = SkTypography.caption.copy(fontSize = 11.5.sp),
                        color = p.onSurfaceVariant.color,
                    )
                }
                SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = 18.dp)
            }
        }
    }
}

@Composable
private fun ListRow(
    index: Int,
    count: Int,
    onClick: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    val top = if (index == 0) BIG else SMALL
    val bottom = if (index == count - 1) BIG else SMALL
    Row(
        Modifier
            .fillMaxWidth()
            .background(SkTheme.palette.surface1.color, RoundedCornerShape(top.dp, top.dp, bottom.dp, bottom.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 9.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** The mockup's pills: done (primary container), waiting/in chair (tertiary), missed (error), later (neutral). */
@Composable
fun StatusPill(status: VisitStatus) {
    val p = SkTheme.palette
    val (bg, ink, label) =
        when (status) {
            VisitStatus.Completed -> {
                Triple(p.primaryContainer, p.onPrimaryContainer, R.string.v7_pill_done)
            }

            VisitStatus.InChair -> {
                Triple(p.tertiaryContainer, p.onTertiaryContainer, R.string.v7_pill_in_chair)
            }

            VisitStatus.Arrived -> {
                Triple(p.tertiaryContainer, p.onTertiaryContainer, R.string.v7_pill_waiting)
            }

            VisitStatus.NoShow, VisitStatus.Cancelled -> {
                Triple(
                    p.errorContainer,
                    p.onErrorContainer,
                    R.string.v7_pill_missed,
                )
            }

            else -> {
                Triple(p.surface3, p.onSurfaceVariant, R.string.v7_pill_booked)
            }
        }
    Text(
        stringResource(label).uppercase(),
        style = SkTypography.chip,
        color = ink.color,
        modifier = Modifier.background(bg.color, CircleShape).padding(horizontal = 8.dp, vertical = 4.dp),
        maxLines = 1,
    )
}

private const val SIDE = 16
private const val CARD = 136
private const val FIRST = 164
private const val CAR_RADIUS = 20
private const val CAR_AVATAR = 42
private const val BIG = 22
private const val SMALL = 8
private const val LIST_SHAPE = 36
