package com.aarogyam.staff.android.ui.today

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.rupees
import com.aarogyam.staff.today.HeroKind
import com.aarogyam.staff.today.MoneyView
import com.aarogyam.staff.today.ScheduleItem
import com.aarogyam.staff.today.TodayCountsView
import com.sakalya.mobile.design.Motion
import com.sakalya.mobile.design.ReducedMotion
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkLiveDot
import com.sakalya.mobile.designcompose.SkMorphingBlob
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.compose

/** Visits, waiting (warm) and done as one joined row of three (`.stats`). */
@Composable
fun TodayStats(counts: TodayCountsView) {
    val p = SkTheme.palette
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        val cells =
            listOf(
                Triple(counts.visits, R.string.v7_stat_visits, false),
                Triple(counts.waiting, R.string.v7_stat_waiting, true),
                Triple(counts.done, R.string.v7_stat_done, false),
            )
        cells.forEachIndexed { i, (n, label, warm) ->
            val start = if (i == 0) BIG else SMALL
            val end = if (i == cells.lastIndex) BIG else SMALL
            val bg = if (warm) p.tertiaryContainer.color else p.surface2.color
            val ink = if (warm) p.onTertiaryContainer.color else p.onSurface.color
            Column(
                Modifier
                    .weight(
                        1f,
                    ).background(
                        bg,
                        RoundedCornerShape(start.dp, end.dp, end.dp, start.dp),
                    ).padding(horizontal = 10.dp, vertical = 9.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(n.toString(), style = SkTypography.number.copy(fontSize = 17.sp), color = ink)
                Text(
                    stringResource(label),
                    style = SkTypography.caption.copy(fontSize = 10.5.sp),
                    color = if (warm) ink.copy(alpha = WARM_LABEL) else p.onSurfaceVariant.color,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * Who is in the chair now, or who is next: the brand gradient card with a morphing blob, a live
 * dot, the day's progress ring and Open record / Call in.
 */
@Composable
fun TodayHero(
    kind: HeroKind,
    item: ScheduleItem,
    progress: Float,
    done: Int,
    total: Int,
    onOpen: () -> Unit,
    onCallIn: (() -> Unit)?,
) {
    val p = SkTheme.palette
    val white = Color.White
    val shape = RoundedCornerShape(HERO_RADIUS.dp)
    Box(
        Modifier
            .padding(top = 8.dp)
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.linearGradient(listOf(p.primary.color, p.primary2.color)))
            .clickable(role = Role.Button, onClick = onOpen),
    ) {
        Box(Modifier.matchParentSize()) {
            SkMorphingBlob(
                p.primaryContainer.color.copy(alpha = HERO_BLOB_ALPHA),
                Modifier.requiredSize(HERO_BLOB.dp).align(Alignment.TopEnd).offset(40.dp, (-50).dp),
            )
        }
        ProgressRing(progress, "$done/$total", Modifier.align(Alignment.TopEnd).padding(13.dp).size(RING.dp))
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                SkLiveDot()
                val kicker = if (kind == HeroKind.Now) R.string.v7_hero_now else R.string.v7_hero_next
                Text(
                    listOfNotNull(
                        stringResource(kicker),
                        item.starts.short(),
                        item.room,
                    ).joinToString(" · ").uppercase(),
                    style = SkTypography.overline.copy(fontSize = 10.5.sp, letterSpacing = 0.84.sp),
                    color = white.copy(alpha = KICK_ALPHA),
                )
            }
            Text(
                item.patientName,
                style = SkTypography.headline.copy(fontSize = 18.sp),
                color = p.onPrimary.color,
                modifier =
                    Modifier.padding(
                        end =
                            (
                                RING +
                                    8
                            ).dp,
                    ),
            )
            item.reason?.let {
                Text(
                    it,
                    style = SkTypography.footnote.copy(fontSize = 12.sp),
                    color = p.onPrimary.color.copy(alpha = SUB_ALPHA),
                )
            }
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HeroButton(stringResource(R.string.v7_hero_open), white, p.primary.color, onOpen)
                onCallIn?.let {
                    HeroButton(
                        stringResource(R.string.v7_hero_call_in),
                        white.copy(alpha = TON_ALPHA),
                        white,
                        it,
                    )
                }
            }
        }
    }
}

@Composable
private fun HeroButton(
    text: String,
    background: Color,
    ink: Color,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .height(
                HERO_BTN.dp,
            ).clip(
                CircleShape,
            ).background(background)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = SkTypography.callout.copy(fontWeight = FontWeight.Bold), color = ink)
    }
}

/** The hero's ring: a white arc that draws to [progress] on entry, with "done/total" inside. */
@Composable
private fun ProgressRing(
    progress: Float,
    label: String,
    modifier: Modifier,
) {
    val reduced = SkTheme.reducedMotion
    val sweep = remember { Animatable(if (reduced == ReducedMotion.On) progress else 0f) }
    LaunchedEffect(progress) {
        if (reduced ==
            ReducedMotion.On
        ) {
            sweep.snapTo(progress)
        } else {
            sweep.animateTo(progress, tween(RING_MS, easing = Motion.emphasized.compose))
        }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(RING.dp)) {
            val w = RING_STROKE.dp.toPx()
            val inset = w / 2
            val arc = Size(size.width - w, size.height - w)
            drawArc(Color.White.copy(alpha = RING_BG), 0f, FULL, false, Offset(inset, inset), arc, style = Stroke(w))
            drawArc(
                Color.White,
                -QUARTER,
                FULL * sweep.value,
                false,
                Offset(inset, inset),
                arc,
                style = Stroke(w, cap = StrokeCap.Round),
            )
        }
        Text(
            label,
            style = SkTypography.caption.copy(fontWeight = FontWeight.ExtraBold, fontSize = 11.sp),
            color = Color.White,
            textAlign = TextAlign.Center,
        )
    }
}

/** Collected today and Expenses today (owner and finance only), with "+ Add expense". */
@Composable
fun MoneyCards(
    money: MoneyView,
    onAddExpense: (() -> Unit)?,
) {
    val p = SkTheme.palette
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SkCard(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.v7_money_collected),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
            Text(
                money.collectedPaise.rupees(),
                style = SkTypography.number.copy(fontSize = 16.sp),
                color = p.onSurface.color,
            )
            Text(
                stringResource(R.string.v7_money_dues, money.pendingDuesPaise.rupees()),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
        }
        SkCard(
            Modifier.weight(1f).then(
                if (onAddExpense !=
                    null
                ) {
                    Modifier.clickable(role = Role.Button, onClick = onAddExpense)
                } else {
                    Modifier
                },
            ),
        ) {
            Text(
                stringResource(R.string.v7_money_expenses),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
            )
            Text(
                money.expensesTodayPaise?.rupees() ?: "—",
                style = SkTypography.number.copy(fontSize = 16.sp),
                color = p.onSurface.color,
            )
            if (onAddExpense !=
                null
            ) {
                Text(
                    stringResource(R.string.v7_money_add_expense),
                    style = SkTypography.caption.copy(fontWeight = FontWeight.Bold),
                    color = p.primary.color,
                )
            }
        }
    }
}

private const val BIG = 22
private const val SMALL = 8
private const val WARM_LABEL = 0.85f
private const val HERO_RADIUS = 24
private const val HERO_BLOB = 170
private const val HERO_BLOB_ALPHA = 0.22f
private const val KICK_ALPHA = 0.9f
private const val SUB_ALPHA = 0.88f
private const val TON_ALPHA = 0.2f
private const val HERO_BTN = 36
private const val RING = 46
private const val RING_STROKE = 5
private const val RING_BG = 0.22f
private const val RING_MS = 1200
private const val FULL = 360f
private const val QUARTER = 90f
