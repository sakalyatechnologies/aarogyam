package com.aarogyam.staff.clinic

import com.aarogyam.staff.api.model.SessionClinic
import com.sakalya.mobile.design.AppTheme
import com.sakalya.mobile.design.BrandPreset
import com.sakalya.mobile.design.HexColor
import com.sakalya.mobile.design.ThemeMode
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** The clinic's theme choice as `/session` reports it. */
enum class BrandMode { Light, Dark, System }

/** A clinic's brand colour and mode; a missing or invalid colour falls back to Tulsi. */
data class ClinicBranding(
    val brand: HexColor,
    val mode: BrandMode,
) {
    /** The theme to draw with, given whether the phone is in dark mode. */
    fun theme(systemDark: Boolean): AppTheme {
        val dark =
            when (mode) {
                BrandMode.Light -> false
                BrandMode.Dark -> true
                BrandMode.System -> systemDark
            }
        return AppTheme.create(brand, if (dark) ThemeMode.Dark else ThemeMode.Light)
    }

    companion object {
        /** The default before a clinic is open. */
        val Default: ClinicBranding = ClinicBranding(BrandPreset.Tulsi.brand, BrandMode.System)

        /** Reads `branding.brand` and `branding.mode` from the session's clinic. */
        fun of(clinic: SessionClinic): ClinicBranding {
            val brand = (clinic.branding["brand"] as? JsonPrimitive)?.contentOrNull?.let(HexColor::parse)
            val mode =
                when ((clinic.branding["mode"] as? JsonPrimitive)?.contentOrNull) {
                    "light" -> BrandMode.Light
                    "dark" -> BrandMode.Dark
                    else -> BrandMode.System
                }
            return ClinicBranding(brand ?: Default.brand, mode)
        }
    }
}
