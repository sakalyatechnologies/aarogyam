package com.aarogyam.staff.android.ui.today

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.art.ArtImage
import com.aarogyam.staff.art.AvatarArt
import com.aarogyam.staff.today.MeView
import com.aarogyam.staff.today.ScheduleItem
import com.aarogyam.staff.today.VisitStatus
import com.sakalya.mobile.design.Motion
import com.sakalya.mobile.design.ReducedMotion
import com.sakalya.mobile.designcompose.SkAvatarFrame
import com.sakalya.mobile.designcompose.SkAvatarShape
import com.sakalya.mobile.designcompose.SkMorphingBlob
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.compose
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import java.time.DayOfWeek as JavaDay
import java.time.format.TextStyle as DayText

/**
 * The swipeable pair at the top of Today: the "me" card (avatar, greeting, chips, the day's
 * progress) and the dark "My schedule" card with the week strip and the member's next visits.
 */
@Composable
fun MePager(
    me: MeView,
    roleName: String,
    avatar: String,
    today: LocalDate,
    waiting: Int,
    onEditAvatar: () -> Unit,
    onOpen: (ScheduleItem) -> Unit,
) {
    val pager = rememberPagerState { 2 }
    Column {
        HorizontalPager(pager, pageSpacing = PAGE_GAP.dp, modifier = Modifier.padding(top = 8.dp)) { page ->
            if (page == 0) MeCard(me, roleName, avatar, waiting, onEditAvatar) else MySchedule(me, today, onOpen)
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally),
        ) {
            repeat(2) { i ->
                val on = pager.currentPage == i
                val w by animateDpAsState(
                    if (on) DOT_ON.dp else DOT.dp,
                    Motion.press.compose(SkTheme.reducedMotion),
                    label = "dot",
                )
                val dotColor = if (on) SkTheme.palette.primary.color else SkTheme.palette.outline.color
                Box(Modifier.height(DOT.dp).width(w).background(dotColor, CircleShape))
            }
        }
    }
}

@Composable
private fun MeCard(
    me: MeView,
    roleName: String,
    avatar: String,
    waiting: Int,
    onEditAvatar: () -> Unit,
) {
    val p = SkTheme.palette
    val ink = p.onPrimaryContainer.color
    val glass = Color.White.copy(alpha = GLASS)
    val shape = RoundedCornerShape(CARD_RADIUS.dp)
    val mixed = lerp(p.primaryContainer.color, p.tertiaryContainer.color, MIX)
    val brush = Brush.linearGradient(listOf(p.primaryContainer.color, mixed))
    Box(Modifier.fillMaxWidth().clip(shape).background(brush)) {
        Box(Modifier.matchParentSize()) {
            SkMorphingBlob(
                p.primary.color.copy(alpha = BLOB_ALPHA),
                Modifier.requiredSize(BLOB.dp).align(Alignment.BottomEnd).offset(BLOB_X.dp, BLOB_Y.dp),
                periodMs = BLOB_MS,
            )
        }
        Column(Modifier.padding(CARD_PAD.dp), verticalArrangement = Arrangement.spacedBy(CARD_GAP.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(CARD_GAP.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SkAvatarFrame(SkAvatarShape.Pebble, AVATAR.dp, glass) {
                    AvatarArt.all[avatar]?.let { ArtImage(it, Modifier.fillMaxWidth().fillMaxHeight()) }
                }
                Column {
                    Text(
                        roleName,
                        style = SkTypography.caption.copy(fontWeight = FontWeight.Bold),
                        color = ink.copy(alpha = ROLE_ALPHA),
                    )
                    Text(
                        stringResource(R.string.v7_me_hello, me.name),
                        style = SkTypography.headline.copy(fontSize = 19.sp, lineHeight = 20.sp),
                        color = ink,
                    )
                }
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val chipBg = Color.White.copy(alpha = CHIP_ALPHA)
                chips(me, waiting).forEach { chip ->
                    Text(
                        chip,
                        style = SkTypography.caption.copy(fontWeight = FontWeight.Bold),
                        color = ink,
                        modifier = Modifier.background(chipBg, CircleShape).padding(horizontal = 9.dp, vertical = 5.dp),
                    )
                }
            }
            DayProgress(me, ink)
        }
        Box(Modifier.align(Alignment.TopEnd).padding(10.dp)) {
            IconWell(
                "spark",
                stringResource(R.string.v7_me_change_avatar),
                onEditAvatar,
                tint = ink,
                background = glass,
            )
        }
    }
}

@Composable
private fun chips(
    me: MeView,
    waiting: Int,
): List<String> =
    buildList {
        if (me.practitionerId != null) {
            add(pluralText(R.plurals.v7_me_for_you, me.remaining))
            me.treatments.take(2).forEach { add("${it.count} ${it.name}") }
        } else {
            add(pluralText(R.plurals.v7_me_waiting, waiting))
        }
        if (me.onLeave) add(stringResource(R.string.v7_me_on_leave))
    }

@Composable
private fun DayProgress(
    me: MeView,
    ink: Color,
) {
    val total = me.mine.size
    if (total == 0) return
    val done = total - me.remaining
    val ends = me.shifts.lastOrNull()?.ends
    val reduced = SkTheme.reducedMotion
    val grow = remember { Animatable(if (reduced == ReducedMotion.On) 1f else 0f) }
    LaunchedEffect(done, total) {
        if (reduced == ReducedMotion.Off) grow.animateTo(1f, tween(GROW_MS, GROW_DELAY_MS, Motion.emphasized.compose))
    }
    val share = done.toFloat() / total
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            val label = SkTypography.caption.copy(fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.v7_me_your_day), style = label, color = ink.copy(alpha = DAY_ALPHA))
            Text(
                if (ends != null) {
                    LocalResources.current.getQuantityString(
                        R.plurals.v7_me_done_until,
                        done,
                        done,
                        total,
                        ends.clock(LocalConfiguration.current.locales[0]),
                    )
                } else {
                    LocalResources.current.getQuantityString(R.plurals.v7_me_done, done, done, total)
                },
                style = label,
                color = ink.copy(alpha = DAY_ALPHA),
            )
        }
        val trackShape = RoundedCornerShape(TRACK_RADIUS.dp)
        Box(
            Modifier
                .fillMaxWidth()
                .height(TRACK.dp)
                .clip(trackShape)
                .background(Color.White.copy(alpha = GLASS)),
        ) {
            val fill = SkTheme.palette.primary.color
            Box(
                Modifier.fillMaxWidth().height(TRACK.dp).drawWithContent {
                    val r = CornerRadius(TRACK_RADIUS.dp.toPx())
                    drawRoundRect(fill, size = size.copy(width = size.width * share * grow.value), cornerRadius = r)
                },
            )
        }
    }
}

@Composable
private fun MySchedule(
    me: MeView,
    today: LocalDate,
    onOpen: (ScheduleItem) -> Unit,
) {
    val p = SkTheme.palette
    val ink = p.onInverseSurface.color
    val monday = today.minus(DatePeriod(days = today.dayOfWeek.ordinal))
    Column(
        Modifier
            .fillMaxWidth()
            .background(p.inverseSurface.color, RoundedCornerShape(CARD_RADIUS.dp))
            .padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(R.string.v7_me_my_schedule),
            style = SkTypography.titleSmall.copy(fontWeight = FontWeight.ExtraBold, fontSize = 16.sp),
            color = ink,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            (0 until DAYS).forEach { i ->
                val day = monday.plus(DatePeriod(days = i))
                val on = day == today
                Column(
                    Modifier.width(WEEK_CELL.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        weekdayLetter(day),
                        style = SkTypography.caption.copy(fontSize = 10.sp),
                        color = ink.copy(alpha = if (on) 1f else DIM),
                    )
                    Box(
                        Modifier
                            .size(WEEK_DAY.dp)
                            .background(if (on) p.primaryContainer.color else Color.Transparent, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            day.day.toString(),
                            style = SkTypography.callout.copy(fontSize = 13.sp, fontWeight = FontWeight.Bold),
                            color = if (on) p.onPrimaryContainer.color else ink.copy(alpha = DIM),
                        )
                    }
                }
            }
        }
        val next = me.mine.firstOrNull { it.status !in DONE }
        val rows = me.mine.filter { it.status !in DONE }.take(ROWS)
        if (rows.isEmpty()) {
            Text(
                stringResource(R.string.v7_me_nothing_left),
                style = SkTypography.footnote,
                color = ink.copy(alpha = DIM),
            )
        }
        rows.forEach { item ->
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(item) }.padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                InitialsAvatar(item.patientName, ROW_AVATAR.dp, cool = true)
                Column(Modifier.weight(1f)) {
                    Text(
                        item.patientName,
                        style = SkTypography.bodyStrong.copy(fontSize = 12.5.sp),
                        color = ink,
                        maxLines = 1,
                    )
                    item.reason?.let { reason ->
                        Text(reason, style = SkTypography.caption, color = ink.copy(alpha = DIM), maxLines = 1)
                    }
                }
                val now = item == next
                Text(
                    if (now) stringResource(R.string.v7_me_next_at, item.starts.short()) else item.starts.short(),
                    style = Mono,
                    color = if (now) Color.White else ink.copy(alpha = TIME_ALPHA),
                    modifier =
                        Modifier
                            .background(
                                if (now) p.tertiary.color else Color.White.copy(alpha = TIME_BG),
                                RoundedCornerShape(8.dp),
                            ).padding(horizontal = 7.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun weekdayLetter(day: LocalDate): String =
    JavaDay.of(day.dayOfWeek.ordinal + 1).getDisplayName(DayText.NARROW, LocalConfiguration.current.locales[0])

@Composable
private fun pluralText(
    id: Int,
    n: Int,
): String = LocalResources.current.getQuantityString(id, n, n)

private val DONE = setOf(VisitStatus.Completed, VisitStatus.NoShow, VisitStatus.Cancelled)

// Measured from the mockup (.mecard, .dark, .medots with the v7.2 overrides).
private const val PAGE_GAP = 10
private const val CARD_RADIUS = 26
private const val CARD_PAD = 14
private const val CARD_GAP = 12
private const val AVATAR = 76
private const val MIX = 0.45f
private const val GLASS = 0.55f
private const val CHIP_ALPHA = 0.6f
private const val ROLE_ALPHA = 0.75f
private const val DAY_ALPHA = 0.85f
private const val BLOB = 160
private const val BLOB_X = 50
private const val BLOB_Y = 60
private const val BLOB_ALPHA = 0.08f
private const val BLOB_MS = 9000
private const val TRACK = 8
private const val TRACK_RADIUS = 4
private const val GROW_MS = 1200
private const val GROW_DELAY_MS = 300
private const val DAYS = 7
private const val WEEK_CELL = 34
private const val WEEK_DAY = 30
private const val DIM = 0.6f
private const val ROWS = 3
private const val ROW_AVATAR = 36
private const val TIME_ALPHA = 0.8f
private const val TIME_BG = 0.08f
private const val DOT = 6
private const val DOT_ON = 18
