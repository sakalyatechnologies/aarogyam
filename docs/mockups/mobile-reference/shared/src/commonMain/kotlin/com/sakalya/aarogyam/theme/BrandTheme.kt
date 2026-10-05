package com.sakalya.aarogyam.theme

/**
 * White-label theme engine (mirrors @sakalya/tokens on web).
 * One brand colour derives the full palette — light AND dark —
 * so per-clinic theming is data, never a redesign.
 *
 * Colours are ARGB Longs (0xFF136650) to stay platform-agnostic.
 */
data class ClinicPalette(
    val brand: Long,
    val brandDark: Long,
    val brandSoft: Long,
    val onBrand: Long = 0xFFFFFFFFL,
)

private fun channel(argb: Long, shift: Int): Int = ((argb shr shift) and 0xFF).toInt()

private fun mix(a: Long, b: Long, weightOfB: Double): Long {
    val r = (channel(a, 16) * (1 - weightOfB) + channel(b, 16) * weightOfB).toInt()
    val g = (channel(a, 8) * (1 - weightOfB) + channel(b, 8) * weightOfB).toInt()
    val bl = (channel(a, 0) * (1 - weightOfB) + channel(b, 0) * weightOfB).toInt()
    return (0xFF000000L) or (r.toLong() shl 16) or (g.toLong() shl 8) or bl.toLong()
}

/** Derive the full palette from a single brand colour. */
fun paletteFor(brandArgb: Long): ClinicPalette = ClinicPalette(
    brand = brandArgb,
    brandDark = mix(brandArgb, 0xFF000000L, 0.32),
    brandSoft = mix(brandArgb, 0xFFFFFFFFL, 0.86),
)

/** The six presets from the gallery, plus the default. */
object BrandPresets {
    val Tulsi: Long = 0xFF136650L
    val Haldi: Long = 0xFFA86E0FL
    val Indigo: Long = 0xFF4338CAL
    val Rose: Long = 0xFFBE123CL
    val Ocean: Long = 0xFF0E7490L
    val Plum: Long = 0xFF7C3AEDL
}
