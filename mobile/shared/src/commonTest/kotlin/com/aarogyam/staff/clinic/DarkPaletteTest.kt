package com.aarogyam.staff.clinic

import com.sakalya.mobile.design.BrandPreset
import com.sakalya.mobile.design.ColorMath
import com.sakalya.mobile.design.HexColor
import com.sakalya.mobile.design.Hsl
import kotlin.test.Test
import kotlin.test.assertTrue

class DarkPaletteTest {
    private val brands =
        listOf(BrandPreset.Tulsi.brand, HexColor.of("#1565c0"), HexColor.of("#c2185b"), HexColor.of("#ef6c00"))

    @Test
    fun the_dark_look_lifts_the_background_and_keeps_every_label_readable() {
        brands.forEach { brand ->
            val p = ClinicBranding(brand, BrandMode.Dark).theme(systemDark = false).palette
            assertTrue(Hsl.of(p.background).lightness >= 8.0, "$brand: not near black")
            assertTrue(
                Hsl.of(p.card).lightness - Hsl.of(p.background).lightness >= 4.0,
                "$brand: cards stand off the page",
            )
            listOf(
                p.onSurface to p.card,
                p.onSurfaceVariant to p.card,
                p.onPrimaryContainer to p.primaryContainer,
                p.onTertiaryContainer to p.tertiaryContainer,
                p.primary to p.background,
            ).forEach { (fg, bg) -> assertTrue(ColorMath.contrastRatio(fg, bg) >= 4.5, "$brand: $fg on $bg") }
        }
        val light = ClinicBranding(BrandPreset.Tulsi.brand, BrandMode.Light).theme(systemDark = true).palette
        assertTrue(Hsl.of(light.background).lightness > 90.0, "light mode unchanged")
    }
}
