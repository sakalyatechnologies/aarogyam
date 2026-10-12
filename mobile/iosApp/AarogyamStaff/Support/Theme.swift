import AarogyamShared
import SakalyaUI

extension ClinicBranding {
    /// The SakalyaUI theme for this clinic's brand colour and mode, computed by the shared design
    /// module so iOS, Android and the web draw the same colours, with the v7 tonal roles.
    func skTheme(systemDark: Bool) -> SkTheme {
        let dark = isDark(systemDark: systemDark)
        let fallback: SkPalette = dark ? .tulsiDark : .tulsiLight
        return SkTheme(
            palette: SkPalette(tokens: paletteTokens(systemDark: systemDark)) ?? fallback,
            isDark: dark,
            roles: SkRoles(tokens: roleTokens(theme(systemDark: systemDark).palette))
        )
    }
}

/// The v7 roles of a Kotlin `Palette` by token name. Its colours arrive boxed, so the hex is read
/// from each value's description.
func roleTokens(_ palette: Palette) -> [String: String] {
    func hex(_ value: Any) -> String {
        let text = String(describing: value)
        guard let range = text.range(of: "#[0-9a-fA-F]{6}", options: .regularExpression) else { return "#000000" }
        return String(text[range])
    }
    var tokens: [String: String] = [
        "primary": hex(palette.primary), "primary2": hex(palette.primary2), "onPrimary": hex(palette.onPrimary),
        "primaryContainer": hex(palette.primaryContainer), "onPrimaryContainer": hex(palette.onPrimaryContainer),
        "tertiary": hex(palette.tertiary), "tertiaryContainer": hex(palette.tertiaryContainer),
        "onTertiaryContainer": hex(palette.onTertiaryContainer), "background": hex(palette.background),
        "surface1": hex(palette.surface1), "surface2": hex(palette.surface2), "surface3": hex(palette.surface3),
        "card": hex(palette.card), "sheet": hex(palette.sheet), "onSurface": hex(palette.onSurface),
        "onSurfaceVariant": hex(palette.onSurfaceVariant), "outline": hex(palette.outline), "error": hex(palette.error),
        "errorContainer": hex(palette.errorContainer), "onErrorContainer": hex(palette.onErrorContainer),
        "inverseSurface": hex(palette.inverseSurface), "onInverseSurface": hex(palette.onInverseSurface),
        "highlight": hex(palette.highlight),
    ]
    for (i, c) in palette.chart.enumerated() { tokens["chart\(i + 1)"] = hex(c) }
    return tokens
}

extension SkRoles {
    /// A role by its design-token name, as the art catalogue names them.
    func named(_ name: String) -> SkRGB? {
        switch name {
        case "primary": primary
        case "primary2": primary2
        case "onPrimary": onPrimary
        case "primaryContainer": primaryContainer
        case "onPrimaryContainer": onPrimaryContainer
        case "tertiary": tertiary
        case "tertiaryContainer": tertiaryContainer
        case "onTertiaryContainer": onTertiaryContainer
        case "background": background
        case "surface1": surface1
        case "surface2": surface2
        case "surface3": surface3
        case "card": card
        case "sheet": sheet
        case "onSurface": onSurface
        case "onSurfaceVariant": onSurfaceVariant
        case "outline": outline
        case "highlight": highlight
        default: nil
        }
    }
}
