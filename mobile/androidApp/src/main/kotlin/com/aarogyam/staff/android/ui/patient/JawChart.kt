package com.aarogyam.staff.android.ui.patient

import android.content.Context
import android.view.accessibility.AccessibilityManager
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.label
import com.aarogyam.staff.art.JawGeometry
import com.aarogyam.staff.chart.Dentition
import com.aarogyam.staff.chart.ToothView
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** A tooth's fixed colours (the mockup's `.tooth.*`): a radial highlight, the body, and the ink for the number. */
internal class JawPaint(
    val stops: List<Pair<Float, Color>>,
    val ink: Color,
) {
    /** The dot beside a legend label: the body colour. */
    val dot: Color get() = if (stops.size > 2) stops[1].second else stops[0].second

    companion object {
        private fun c(hex: Long) = Color(0xFF000000 or hex)

        fun of(tone: JawTone): JawPaint =
            when (tone) {
                JawTone.Plain -> {
                    JawPaint(listOf(0f to c(0xFFFFFF), 0.45f to c(0xF4F1EA), 1f to c(0xDCD6C8)), c(0x5D6B64))
                }

                JawTone.Treated -> {
                    JawPaint(listOf(0f to c(0xE6FFF4), 0.6f to c(0x9BE3C3), 1f to c(0x5FBF98)), c(0x064A33))
                }

                JawTone.Progress -> {
                    JawPaint(listOf(0f to c(0xFFF2E6), 0.6f to c(0xFFC28F), 1f to c(0xE8833A)), c(0x5A2500))
                }

                JawTone.Watch -> {
                    JawPaint(listOf(0f to c(0xFFFBE6), 0.6f to c(0xFFE58A), 1f to c(0xE6BF2E)), c(0x5A4600))
                }

                JawTone.Care -> {
                    JawPaint(listOf(0f to c(0xFFEDED), 0.6f to c(0xFFB0B0), 1f to c(0xE05555)), c(0x5A0F0F))
                }

                JawTone.Missing -> {
                    JawPaint(
                        listOf(0f to c(0xF4F1EA).copy(alpha = 0.25f), 1f to c(0xDCD6C8).copy(alpha = 0.25f)),
                        c(0x8A948E),
                    )
                }
            }
    }
}

@Composable
private fun JawTone.title(): String =
    stringResource(
        when (this) {
            JawTone.Plain -> R.string.pv_jaw_plain
            JawTone.Treated -> R.string.pv_jaw_treated
            JawTone.Progress -> R.string.pv_jaw_progress
            JawTone.Watch -> R.string.pv_jaw_watch
            JawTone.Care -> R.string.pv_jaw_care
            JawTone.Missing -> R.string.pv_jaw_missing
        },
    )

private const val TILT = 24f
private val JAW_HEIGHT = 250.dp
private const val MAX_TOOTH = 30f
private const val TOOTH_SHARE = 0.084f

/**
 * Both arches of one dentition as the mockup's 2.5D jaw: teeth placed from the shared `JawGeometry`
 * and tilted back. With touch exploration on, the same teeth are a list instead ([JawList]).
 */
@Composable
internal fun JawChart(
    dentition: Dentition,
    teeth: Map<Int, ToothView>,
    upper: List<ToothView>,
    lower: List<ToothView>,
    onSelect: (Int) -> Unit,
) {
    val context = LocalContext.current
    val exploring =
        remember {
            (
                context.getSystemService(
                    Context.ACCESSIBILITY_SERVICE,
                ) as? AccessibilityManager
            )?.isTouchExplorationEnabled ==
                true
        }
    if (exploring) {
        JawList(upper, lower, onSelect)
        return
    }
    val p = SkTheme.palette
    val gum = lerp(Color(0xFFF3A7A7), p.background.color, 0.5f)
    BoxWithConstraints(Modifier.fillMaxWidth().height(JAW_HEIGHT).padding(vertical = 4.dp)) {
        val w = maxWidth
        val h = maxHeight
        val size = minOf(MAX_TOOTH.dp, w * TOOTH_SHARE)
        val density = LocalDensity.current
        Box(
            Modifier
                .fillMaxWidth()
                .height(h)
                .graphicsLayer {
                    rotationX = TILT
                    cameraDistance = CAMERA * density.density
                },
        ) {
            Canvas(Modifier.fillMaxWidth().height(h)) {
                val stroke = 18.dp.toPx()
                val rw = this.size.width * 0.84f
                val rh = this.size.height * 0.92f
                drawOval(
                    gum.copy(alpha = 0.55f),
                    topLeft = Offset((this.size.width - rw) / 2, (this.size.height - rh) / 2),
                    size = Size(rw, rh),
                    style = Stroke(stroke),
                )
            }
            JawGeometry.spots(dentition).forEach { spot ->
                val tooth = teeth[spot.tooth] ?: return@forEach
                JawTooth(
                    tooth,
                    size,
                    Modifier.offset(
                        w * spot.x.toFloat() - size / 2 - TAP_PAD,
                        h * spot.y.toFloat() - size / 2 - TAP_PAD,
                    ),
                ) { onSelect(tooth.number) }
            }
        }
        Centre(teeth.values.count { it.needsCare }, Modifier.align(Alignment.Center))
    }
}

private const val CAMERA = 12f
private val TAP_PAD = 6.dp

@Composable
private fun Centre(
    withHistory: Int,
    modifier: Modifier,
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            stringResource(R.string.pv_jaw_centre, withHistory),
            style = v7(11f, FontWeight.Bold),
            color = SkTheme.palette.onSurfaceVariant.color,
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.pv_jaw_tap),
            style = v7(11f, FontWeight.Medium),
            color = SkTheme.palette.onSurfaceVariant.color,
        )
    }
}

/** One tooth of the jaw: a rounded crown with a lower edge for depth. */
@Composable
private fun JawTooth(
    tooth: ToothView,
    size: Dp,
    modifier: Modifier,
    onTap: () -> Unit,
) {
    val tone = JawTone.of(tooth.headline)
    val paint = JawPaint.of(tone)
    val description =
        stringResource(R.string.pv_tooth_title, tooth.number) + ", " + stringResource(tooth.headline.label())
    Box(
        modifier
            .padding(TAP_PAD)
            .size(size)
            .clickable(role = Role.Button, onClick = onTap)
            .semantics { contentDescription = description }
            .drawBehind {
                val top = CornerRadius(this.size.width * TOP_R)
                val bottom = CornerRadius(this.size.width * BOTTOM_R)
                val outline =
                    Path().apply {
                        addRoundRect(
                            RoundRect(Rect(Offset.Zero, this@drawBehind.size), top, top, bottom, bottom),
                        )
                    }
                if (tone != JawTone.Missing) {
                    translate(0f, this.size.height * DEPTH) { drawPath(outline, Color(0xFFC9C2B1)) }
                }
                val brush =
                    Brush.radialGradient(
                        colorStops = paint.stops.toTypedArray(),
                        center = Offset(this.size.width * 0.35f, this.size.height * 0.3f),
                        radius = this.size.width * 0.8f,
                    )
                drawPath(outline, brush)
                if (tone == JawTone.Missing) {
                    drawPath(
                        outline,
                        paint.ink,
                        style =
                            Stroke(
                                1.dp.toPx(),
                                pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx())),
                            ),
                    )
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            tooth.number.toString(),
            style =
                v7(
                    10f,
                    FontWeight.Bold,
                ).copy(fontFamily = FontFamily.Monospace, fontSize = (size.value * NUMBER).sp),
            color = paint.ink,
        )
    }
}

private const val TOP_R = 0.44f
private const val BOTTOM_R = 0.48f
private const val DEPTH = 0.16f
private const val NUMBER = 0.32f

/** The jaw's legend: a dot and a label per colour, centred. */
@Composable
internal fun JawLegend() {
    Flow(Modifier.fillMaxWidth(), spacing = 10.dp) {
        listOf(JawTone.Treated, JawTone.Progress, JawTone.Watch, JawTone.Care, JawTone.Missing).forEach { tone ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.size(10.dp).background(JawPaint.of(tone).dot, CircleShape))
                Text(tone.title(), style = v7(11.5f), color = SkTheme.palette.onSurfaceVariant.color)
            }
        }
    }
}

/** The list that stands in for the jaw with TalkBack on: every tooth, its finding, one tap to open. */
@Composable
private fun JawList(
    upper: List<ToothView>,
    lower: List<ToothView>,
    onSelect: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        JawSection(stringResource(R.string.pv_jaw_upper), upper, onSelect)
        JawSection(stringResource(R.string.pv_jaw_lower), lower, onSelect)
    }
}

@Composable
private fun JawSection(
    title: String,
    teeth: List<ToothView>,
    onSelect: (Int) -> Unit,
) {
    val p = SkTheme.palette
    Text(
        title,
        style = v7(11f, FontWeight.Bold),
        color = p.onSurfaceVariant.color,
        modifier = Modifier.padding(top = 6.dp),
    )
    teeth.forEach { tooth ->
        Row(
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 44.dp)
                .background(p.surface2.color, RoundedCornerShape(12.dp))
                .clickable(role = Role.Button) { onSelect(tooth.number) }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.size(12.dp).background(JawPaint.of(JawTone.of(tooth.headline)).dot, CircleShape))
            Text(tooth.number.toString(), style = v7(13.5f, FontWeight.Bold), color = p.onSurface.color)
            Text(stringResource(tooth.headline.label()), style = v7(12f), color = p.onSurfaceVariant.color)
        }
    }
}
