package com.aarogyam.staff.clinic

import com.sakalya.mobile.design.Hsl
import com.sakalya.mobile.design.Palette

/**
 * The app's dark look on top of the design kit's dark palette (founder review, 22 Nov 2026): a
 * softly brand-tinted background instead of near black, cards that stand clearly off it, and
 * richer green and amber containers with brighter labels, so avatars and kind tiles read as colour
 * rather than mud. Light mode is unchanged.
 */
internal fun Palette.refinedDark(): Palette {
    val h = Hsl.of(primary).hue
    val warm = Hsl.of(tertiary).hue

    fun c(
        hue: Double,
        s: Double,
        l: Double,
    ) = Hsl(hue, s, l).toHex()
    return copy(
        background = c(h, 16.0, 9.0),
        surface1 = c(h, 14.0, 12.0),
        surface2 = c(h, 13.0, 15.0),
        surface3 = c(h, 12.0, 19.0),
        card = c(h, 14.0, 13.5),
        sheet = c(h, 14.0, 12.0),
        outline = c(h, 10.0, 30.0),
        onSurfaceVariant = c(h, 10.0, 76.0),
        primaryContainer = c(h, 45.0, 22.0),
        onPrimaryContainer = c(h, 70.0, 86.0),
        tertiaryContainer = c(warm, 55.0, 20.0),
        onTertiaryContainer = c(warm, 95.0, 78.0),
    )
}
