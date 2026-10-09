package com.aarogyam.staff.art

import com.aarogyam.staff.chart.Dentition
import com.sakalya.mobile.design.BrandPreset
import com.sakalya.mobile.design.Palette
import com.sakalya.mobile.design.PathData
import com.sakalya.mobile.design.PathParse
import com.sakalya.mobile.design.ThemeMode
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ArtTest {
    private val pieces = IconArt.all + AvatarArt.all + IllustrationArt.all

    @Test
    fun every_layer_parses() {
        for ((name, piece) in pieces) {
            for (layer in piece.layers) {
                assertIs<PathParse.Parsed>(
                    PathData.parse(layer.path),
                    "$name: ${layer.path.take(40)}",
                )
            }
        }
    }

    @Test
    fun the_catalogue_has_the_mockups_pieces() {
        assertEquals(33, IconArt.all.size)
        assertEquals((1..8).map { "d$it" }.toSet(), AvatarArt.all.keys)
        assertEquals(setOf("tooth", "family", "implant"), IllustrationArt.all.keys)
        assertTrue("tooth" in IconArt.all && "rx" in IconArt.all && "wa" in IconArt.all, IconArt.all.keys.toString())
    }

    @Test
    fun theme_colours_name_real_palette_roles() {
        val roles = Palette.of(BrandPreset.Tulsi, ThemeMode.Light).toMap().keys

        fun ArtColor.ok() = this !is ArtColor.Role || name in roles

        fun ArtPaint.colors(): List<ArtColor> =
            when (this) {
                ArtPaint.None -> emptyList()
                is ArtPaint.Solid -> listOf(color)
                is ArtPaint.Linear -> stops.map { it.color }
                is ArtPaint.Radial -> stops.map { it.color }
            }
        for ((name, piece) in pieces) {
            for (layer in piece.layers) {
                (layer.fill.colors() + layer.stroke.colors()).forEach { assertTrue(it.ok(), "$name uses $it") }
            }
        }
    }

    @Test
    fun avatars_keep_their_blink_and_bob() {
        val loops =
            AvatarArt.all
                .getValue("d1")
                .layers
                .flatMap { l -> l.loops.map { it.kind } }
                .toSet()
        assertEquals(setOf("bob", "blink"), loops)
    }

    @Test
    fun the_jaw_spreads_each_arch_on_half_an_ellipse() {
        val adult = JawGeometry.spots(Dentition.Adult)
        assertEquals(32, adult.size)
        val first = adult.first()
        assertEquals(18, first.tooth)
        assertTrue(first.x < 0.1 && first.y > 0.4 && first.y < 0.5, first.toString())
        val middle = adult.first { it.tooth == 11 }
        assertTrue(abs(middle.y - (0.5 - 0.4 * 0.98 * kotlin.math.sin(kotlin.math.PI * (1 - 7.5 / 16)))) < 1e-9)
        assertTrue(adult.filter { !it.upper }.all { it.y > 0.5 })
        assertEquals(20, JawGeometry.spots(Dentition.Child).size)
    }
}
