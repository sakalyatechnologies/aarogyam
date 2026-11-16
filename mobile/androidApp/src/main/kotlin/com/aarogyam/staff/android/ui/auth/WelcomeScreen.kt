package com.aarogyam.staff.android.ui.auth

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.art.ArtImage
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.art.IllustrationArt
import com.sakalya.mobile.designcompose.SkMorphingBlob
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

private class Slide(
    val art: String,
    val warm: Boolean,
    val title: Int,
    val message: Int,
)

private val slides =
    listOf(
        Slide("tooth", false, R.string.sh_s_a_welcome_1_title, R.string.sh_s_a_welcome_1_message),
        Slide("family", true, R.string.sh_s_a_welcome_2_title, R.string.sh_s_a_welcome_2_message),
        Slide("implant", true, R.string.sh_s_a_welcome_3_title, R.string.sh_s_a_welcome_3_message),
    )

/** What the signed-out person sees first: three illustrated slides, dots, "Get started" and "I have a clinic invite". */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun WelcomeScreen(
    onGetStarted: () -> Unit,
    onInvite: () -> Unit,
) {
    val p = SkTheme.palette
    val pager = rememberPagerState { slides.size }
    val wash = Brush.verticalGradient(listOf(p.primaryContainer.color.copy(alpha = 0.5f), p.background.color))
    Column(Modifier.fillMaxSize().background(wash).systemBarsPadding()) {
        HorizontalPager(pager, Modifier.weight(1f)) { SlideView(slides[it]) }
        Column(
            Modifier.padding(start = 22.dp, end = 22.dp, top = 14.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val label = stringResource(R.string.sh_s_a_welcome_page, pager.currentPage + 1, slides.size)
            Row(
                Modifier.align(Alignment.CenterHorizontally).padding(bottom = 6.dp).clearAndSetSemantics {
                    contentDescription =
                        label
                },
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                slides.indices.forEach { i ->
                    val on = i == pager.currentPage
                    Box(
                        Modifier
                            .height(7.dp)
                            .size(width = if (on) 24.dp else 7.dp, height = 7.dp)
                            .background((if (on) p.primary else p.outline).color, CircleShape),
                    )
                }
            }
            SkPillButton(stringResource(R.string.sh_s_a_welcome_get_started), onGetStarted, wide = true)
            SkPillButton(
                stringResource(R.string.sh_s_a_welcome_invite),
                onInvite,
                variant = SkPillVariant.Ghost,
                wide = true,
            )
        }
    }
}

@Composable
private fun SlideView(slide: Slide) {
    val p = SkTheme.palette
    Column(
        Modifier.fillMaxSize().padding(horizontal = 26.dp).padding(top = 40.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            Box(Modifier.size(220.dp), contentAlignment = Alignment.Center) {
                val blob = if (slide.warm) p.tertiary else p.primary
                SkMorphingBlob(blob.color.copy(alpha = 0.9f), Modifier.requiredSize(220.dp))
                IllustrationArt.all[slide.art]?.let {
                    ArtImage(
                        it,
                        Modifier.requiredSize(width = 232.dp, height = 205.dp),
                    )
                }
                Box(
                    Modifier
                        .offset(
                            100.dp,
                            (-88).dp,
                        ).size(46.dp)
                        .clip(CircleShape)
                        .background(p.tertiaryContainer.color),
                )
                Box(
                    Modifier
                        .offset((-104).dp, 80.dp)
                        .size(28.dp)
                        .clip(CircleShape)
                        .background(p.primaryContainer.color),
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                stringResource(slide.title),
                style = v7(31f, FontWeight.ExtraBold).copy(letterSpacing = (-0.8).sp),
                color = p.onSurface.color,
                modifier = Modifier.semantics { heading() },
            )
            Text(stringResource(slide.message), style = v7(15f), color = p.onSurfaceVariant.color)
        }
    }
}
