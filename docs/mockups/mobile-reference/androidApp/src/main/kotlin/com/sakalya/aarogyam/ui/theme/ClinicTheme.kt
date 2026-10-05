package com.sakalya.aarogyam.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.sakalya.aarogyam.theme.ClinicPalette

private fun Long.toColor(): Color = Color(this.toULong())

/** Maps the shared white-label palette onto Material3. */
private fun ClinicPalette.toLightScheme(): ColorScheme = lightColorScheme(
    primary = brand.toColor(),
    onPrimary = onBrand.toColor(),
    primaryContainer = brandSoft.toColor(),
    onPrimaryContainer = brandDark.toColor(),
    surface = Color(0xFFF4F6F4),
    onSurface = Color(0xFF14201B),
)

private fun ClinicPalette.toDarkScheme(): ColorScheme = darkColorScheme(
    primary = brand.toColor(),
    onPrimary = onBrand.toColor(),
    primaryContainer = brandDark.toColor(),
    onPrimaryContainer = brandSoft.toColor(),
    surface = Color(0xFF0E1411),
    onSurface = Color(0xFFE9F0EC),
)

@Composable
fun ClinicTheme(
    palette: ClinicPalette,
    darkTheme: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) palette.toDarkScheme() else palette.toLightScheme(),
        content = content,
    )
}
