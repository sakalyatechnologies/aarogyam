import AarogyamShared
import SakalyaUI

extension ClinicBranding {
    /// The SakalyaUI theme for this clinic's brand colour and mode, computed by the shared design
    /// module so iOS, Android and the web draw the same colours.
    func skTheme(systemDark: Bool) -> SkTheme {
        let dark = isDark(systemDark: systemDark)
        let fallback: SkPalette = dark ? .tulsiDark : .tulsiLight
        return SkTheme(palette: SkPalette(tokens: paletteTokens(systemDark: systemDark)) ?? fallback, isDark: dark)
    }
}
