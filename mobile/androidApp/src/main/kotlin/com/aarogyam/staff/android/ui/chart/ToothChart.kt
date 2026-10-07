package com.aarogyam.staff.android.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.ToothView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Pinch zoom for the chart: 1x to [MAX_ZOOM], panning only while zoomed so the page still scrolls. */
@Stable
class ChartZoom {
    var scale by mutableFloatStateOf(1f)
        private set
    var offset by mutableStateOf(Offset.Zero)
        private set
    internal var size = IntSize.Zero

    val zoomed: Boolean get() = scale > ZOOMED

    internal fun apply(
        zoom: Float,
        pan: Offset,
    ) {
        scale = (scale * zoom).coerceIn(1f, MAX_ZOOM)
        val maxX = size.width * (scale - 1) / 2
        val maxY = size.height * (scale - 1) / 2
        val next = offset + pan
        offset = Offset(next.x.coerceIn(-maxX, maxX), next.y.coerceIn(-maxY, maxY))
    }

    fun reset() {
        scale = 1f
        offset = Offset.Zero
    }

    private companion object {
        const val MAX_ZOOM = 4f
        const val ZOOMED = 1.5f
    }
}

/**
 * Both arches of one dentition, left to right as the clinician faces the patient. A tap picks a
 * tooth; once zoomed in, a tap on a crown also picks that surface.
 */
@Composable
fun ToothChart(
    upper: List<ToothView>,
    lower: List<ToothView>,
    selected: Int?,
    selectedSurface: Surface?,
    zoom: ChartZoom,
    group: List<Int>,
    onSelect: (Int, Surface?) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .clipToBounds()
            .onSizeChanged { zoom.size = it }
            .pointerInput(zoom) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val fingers = event.changes.count { it.pressed }
                        if (fingers >= 2 || zoom.scale > 1f) {
                            val factor = event.calculateZoom()
                            val pan = event.calculatePan()
                            if (factor != 1f || pan != Offset.Zero) {
                                zoom.apply(factor, pan)
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
    ) {
        Column(
            Modifier.graphicsLayer {
                scaleX = zoom.scale
                scaleY = zoom.scale
                translationX = zoom.offset.x
                translationY = zoom.offset.y
            },
        ) {
            ArchLabel(stringResource(R.string.chart_upper))
            Arch(upper, selected, group, selectedSurface, zoom.zoomed, onSelect)
            ArchLabel(stringResource(R.string.chart_lower))
            Arch(lower, selected, group, selectedSurface, zoom.zoomed, onSelect)
        }
    }
}

@Composable
private fun ArchLabel(text: String) =
    Text(
        text,
        style = SkTypography.overline,
        color = SkTheme.colors.textMuted.color,
        modifier = Modifier.padding(vertical = Spacing.S.dp),
    )

@Composable
private fun Arch(
    teeth: List<ToothView>,
    selected: Int?,
    group: List<Int>,
    selectedSurface: Surface?,
    zoomed: Boolean,
    onSelect: (Int, Surface?) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        teeth.forEach { tooth ->
            val isSelected = tooth.number == selected
            Tooth(
                tooth = tooth,
                selected = isSelected || tooth.number in group,
                selectedSurface = selectedSurface.takeIf { isSelected },
                zoomed = zoomed,
                onSelect = { onSelect(tooth.number, it) },
                modifier = Modifier.weight(tooth.kind.weight),
            )
        }
    }
}

@Composable
private fun Tooth(
    tooth: ToothView,
    selected: Boolean,
    selectedSurface: Surface?,
    zoomed: Boolean,
    onSelect: (Surface?) -> Unit,
    modifier: Modifier,
) {
    val colors = SkTheme.colors
    val number = @Composable {
        Text(
            tooth.number.toString(),
            fontSize = 8.sp,
            fontWeight = FontWeight.Bold,
            color =
                if (selected) {
                    colors.primary.color
                } else if (tooth.needsCare) {
                    colors.text.color
                } else {
                    colors.textMuted.color
                },
        )
    }
    val description =
        stringResource(R.string.chart_tooth_description, tooth.number, stringResource(tooth.headline.label()))
    val paints = ToothPaints.from(tooth)
    val outline = colors.rule.color
    val highlight = colors.primary.color
    Column(
        modifier.semantics {
            contentDescription = description
            role = Role.Button
            this.selected = selected
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (tooth.upper) number()
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(TOOTH_HEIGHT.dp)
                .pointerInput(tooth.number, zoomed) {
                    detectTapGestures { at ->
                        val geometry = ToothGeometry(tooth, size.width.toFloat(), size.height.toFloat())
                        onSelect(if (zoomed) geometry.surfaceAt(at) else null)
                    }
                },
        ) {
            drawTooth(
                ToothGeometry(tooth, size.width, size.height),
                paints,
                outline,
                highlight,
                selected,
                selectedSurface,
            )
        }
        if (!tooth.upper) number()
    }
}

/** Crown plus root, in dp; the crown faces the biting plane between the arches. */
private const val TOOTH_HEIGHT = 58
