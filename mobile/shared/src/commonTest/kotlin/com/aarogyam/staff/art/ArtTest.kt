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
        // The two middle teeth sit either side of the top of the arch, at the same height.
        val (left, right) = adult.first { it.tooth == 11 } to adult.first { it.tooth == 21 }
        assertTrue(abs(left.y - right.y) < 1e-6 && left.y < 0.15 && abs(left.x + right.x - 1) < 1e-6)
        assertTrue(adult.filter { !it.upper }.all { it.y > 0.5 })
        assertEquals(20, JawGeometry.spots(Dentition.Child).size)
    }

    @Test
    fun neighbouring_teeth_never_touch_even_at_the_molars_on_a_wide_box() {
        for (aspect in listOf(1.2, 1.57, 1.7, 2.4)) {
            for (dentition in listOf(Dentition.Adult, Dentition.Child)) {
                val size = JawGeometry.toothShare(dentition, aspect)
                val spots = JawGeometry.spots(dentition, aspect)

                // Distance in box widths: y shares are scaled down by the aspect.
                fun apart(
                    a: JawSpot,
                    b: JawSpot,
                ) = kotlin.math.hypot(a.x - b.x, (a.y - b.y) / aspect)
                val pairs =
                    spots.filter { it.upper }.zipWithNext() + spots.filter { !it.upper }.zipWithNext() +
                        listOf(spots.first() to spots.first { !it.upper }, spots.last { it.upper } to spots.last())
                pairs.forEach { (a, b) ->
                    assertTrue(apart(a, b) >= size, "$aspect ${a.tooth}/${b.tooth}: ${apart(a, b)} < $size")
                }
            }
        }
    }

    @Test
    fun icons_merge_into_one_outline_and_matrices_apply() {
        val users = Icons.of("users").commands
        assertTrue(users.count { it is com.sakalya.mobile.design.PathCommand.MoveTo } >= 2, "circle and path")
        assertTrue(Icons.of("nope").commands.isEmpty())
        val moved = ArtLayer("M1 2L3 4", matrix = listOf(2.0, 0.0, 0.0, 2.0, 10.0, 0.0)).pathData()?.commands
        assertEquals(
            com.sakalya.mobile.design.PathCommand
                .MoveTo(12.0, 4.0),
            moved?.first(),
        )
    }
}
