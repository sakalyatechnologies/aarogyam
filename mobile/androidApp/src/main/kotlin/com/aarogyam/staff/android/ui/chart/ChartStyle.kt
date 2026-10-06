package com.aarogyam.staff.android.ui.chart

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import com.aarogyam.staff.android.R
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.chart.SurfaceName
import com.aarogyam.staff.chart.ToothKind
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** How a finding is drawn: a fill, an optional pattern in [ink], and a heavier outline for crowns. */
data class FindingPaint(
    val fill: Color,
    val ink: Color,
    val pattern: Pattern,
)

enum class Pattern { None, Solid, Stripes, Cross, Dots, Vertical, Grid, Bars }

/** The legend's colours, from the clinic theme so they follow light and dark mode. */
@Composable
@ReadOnlyComposable
fun Finding.paint(): FindingPaint {
    val c = SkTheme.colors
    return when (this) {
        Finding.Sound -> FindingPaint(Color.Transparent, c.textMuted.color, Pattern.None)
        Finding.Caries -> FindingPaint(c.danger.color, c.danger.color, Pattern.Solid)
        Finding.Filled -> FindingPaint(c.infoSoft.color, c.info.color, Pattern.Stripes)
        Finding.Crown -> FindingPaint(c.warningSoft.color, c.warning.color, Pattern.Solid)
        Finding.RootCanal -> FindingPaint(c.warningSoft.color, c.warning.color, Pattern.Vertical)
        Finding.Missing -> FindingPaint(Color.Transparent, c.textMuted.color, Pattern.None)
        Finding.Implant -> FindingPaint(c.brandSoft.color, c.primary.color, Pattern.Grid)
        Finding.Bridge -> FindingPaint(c.brandSoft.color, c.primary.color, Pattern.Bars)
        Finding.Fractured -> FindingPaint(c.dangerSoft.color, c.danger.color, Pattern.Cross)
        Finding.Watch -> FindingPaint(c.warningSoft.color, c.warning.color, Pattern.Dots)
    }
}

@StringRes
fun Finding.label(): Int =
    when (this) {
        Finding.Sound -> R.string.finding_sound
        Finding.Caries -> R.string.finding_caries
        Finding.Filled -> R.string.finding_filled
        Finding.Crown -> R.string.finding_crown
        Finding.RootCanal -> R.string.finding_root_canal
        Finding.Missing -> R.string.finding_missing
        Finding.Implant -> R.string.finding_implant
        Finding.Bridge -> R.string.finding_bridge
        Finding.Fractured -> R.string.finding_fractured
        Finding.Watch -> R.string.finding_watch
    }

@StringRes
fun SurfaceName.label(): Int =
    when (this) {
        SurfaceName.Mesial -> R.string.surface_mesial
        SurfaceName.Distal -> R.string.surface_distal
        SurfaceName.Occlusal -> R.string.surface_occlusal
        SurfaceName.Incisal -> R.string.surface_incisal
        SurfaceName.Buccal -> R.string.surface_buccal
        SurfaceName.Facial -> R.string.surface_facial
        SurfaceName.Lingual -> R.string.surface_lingual
        SurfaceName.Palatal -> R.string.surface_palatal
    }

@StringRes
fun ToothKind.label(): Int =
    when (this) {
        ToothKind.Incisor -> R.string.kind_incisor
        ToothKind.Canine -> R.string.kind_canine
        ToothKind.Premolar -> R.string.kind_premolar
        ToothKind.Molar -> R.string.kind_molar
    }

/** Relative crown widths, so molars are wider than incisors as on the web odontogram. */
val ToothKind.weight: Float
    get() =
        when (this) {
            ToothKind.Incisor -> 28f
            ToothKind.Canine -> 30f
            ToothKind.Premolar -> 34f
            ToothKind.Molar -> 42f
        }
