package com.aarogyam.staff.clinic

import com.aarogyam.staff.api.model.SessionClinic
import com.sakalya.mobile.design.AppTheme
import com.sakalya.mobile.design.BrandPreset
import com.sakalya.mobile.design.HexColor
import com.sakalya.mobile.design.ThemeMode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

class ClinicBrandingTest {
    private fun clinic(branding: String) =
        SessionClinic(
            Json.decodeFromString<JsonObject>(branding),
            id = "c",
            name = "Sunrise",
            slug = "sunrise",
            timezone = "Asia/Kolkata",
        )

    @Test
    fun reads_brand_and_mode() {
        val branding = ClinicBranding.of(clinic("""{"brand":"#0E7490","mode":"dark"}"""))
        assertEquals(HexColor.parse("#0e7490"), branding.brand)
        assertEquals(BrandMode.Dark, branding.mode)
        assertEquals(ThemeMode.Dark, branding.theme(systemDark = false).mode)
    }

    @Test
    fun missing_or_invalid_values_fall_back_to_tulsi_and_the_system_mode() {
        val branding = ClinicBranding.of(clinic("""{"brand":"teal","mode":42}"""))
        assertEquals(BrandPreset.Tulsi.brand, branding.brand)
        assertEquals(BrandMode.System, branding.mode)
        assertEquals(AppTheme.of(BrandPreset.Tulsi, ThemeMode.Dark), branding.theme(systemDark = true))
        assertEquals(ClinicBranding.Default, ClinicBranding.of(clinic("{}")))
    }
}
