import SwiftUI
import Shared

// MARK: - White-label theme, mirroring the shared Kotlin palette engine

/// A clinic's brand colour derives this whole struct — same math as
/// `paletteFor` in the shared module, so iOS and Android never drift.
struct ClinicPalette {
    let brand: Color
    let brandDark: Color
    let brandSoft: Color

    static func mix(_ a: UInt32, _ b: UInt32, weightOfB: Double) -> Color {
        func ch(_ v: UInt32, _ s: Int) -> Double { Double((v >> s) & 0xFF) }
        let r = ch(a, 16) * (1 - weightOfB) + ch(b, 16) * weightOfB
        let g = ch(a, 8) * (1 - weightOfB) + ch(b, 8) * weightOfB
        let bl = ch(a, 0) * (1 - weightOfB) + ch(b, 0) * weightOfB
        return Color(red: r / 255, green: g / 255, blue: bl / 255)
    }

    init(brandHex: UInt32) {
        let full = 0xFF00_0000 | brandHex
        self.brand = Self.mix(full, full, weightOfB: 0) // exact brand
        self.brandDark = Self.mix(full, 0xFF00_0000, weightOfB: 0.32)
        self.brandSoft = Self.mix(full, 0xFFFF_FFFF, weightOfB: 0.86)
    }

    // Presets matching the gallery + shared BrandPresets
    static let tulsi  = ClinicPalette(brandHex: 0x136650)
    static let haldi  = ClinicPalette(brandHex: 0xA86E0F)
    static let indigo = ClinicPalette(brandHex: 0x4338CA)
    static let rose   = ClinicPalette(brandHex: 0xBE123C)
}

private struct PaletteKey: EnvironmentKey { static let defaultValue = ClinicPalette.tulsi }
extension EnvironmentValues {
    var clinicPalette: ClinicPalette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
}
