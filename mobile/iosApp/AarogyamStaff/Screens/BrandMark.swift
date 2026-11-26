import SakalyaUI
import SwiftUI

/// The app logo and name, at the top left of the main screens.
struct BrandMark: View {
    /// Tapping the logo goes home.
    var onTap: () -> Void = {}

    var body: some View {
        Button(action: onTap) { mark }
            .buttonStyle(.plain)
            .accessibilityLabel("Aarogyam")
            .accessibilityAddTraits(.isButton)
    }

    private var mark: some View {
        HStack(spacing: 6) {
            BrandGlyph().frame(width: 28, height: 28).accessibilityHidden(true)
            Text("Aarogyam").font(.headline.weight(.bold))
        }
        // The toolbar would otherwise squeeze the name down to the mark.
        .fixedSize()
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
    }
}

extension View {
    /// Puts the logo and name in the navigation bar's leading corner; a tap runs [onTap] (home).
    func brandMark(onTap: @escaping () -> Void = {}) -> some View {
        toolbar { ToolbarItem(placement: .topBarLeading) { BrandMark(onTap: onTap) } }
    }
}

/// The A and its crossbar (brand/aarogyam-mark.svg geometry) on the header's soft tile. The A takes the
/// theme's text colour and the bar its primary, on the inset tile, so the logo follows the clinic theme and dark mode.
struct BrandGlyph: View {
    @Environment(\.skTheme) private var theme

    var body: some View {
        GeometryReader { geo in
            let side = geo.size.width
            ZStack {
                RoundedRectangle(cornerRadius: side * 0.29, style: .continuous)
                    .fill(theme.palette.inset.color)
                GlyphStroke(bar: false)
                    .stroke(theme.palette.text.color, style: stroke(side, 10))
                GlyphStroke(bar: true)
                    .stroke(theme.palette.primary.color, style: stroke(side, 8))
            }
        }
    }

    private func stroke(_ side: CGFloat, _ weight: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: weight * 0.72 * side / 100, lineCap: .round, lineJoin: .round)
    }
}

/// The A (or its crossbar) in the mark's 100-unit grid, inset the way the mark tile insets it.
private struct GlyphStroke: Shape {
    let bar: Bool

    func path(in rect: CGRect) -> Path {
        let unit = rect.width * 0.72 / 100
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * 0.14 + x * unit, y: rect.minY + rect.height * 0.14 + y * unit)
        }
        var path = Path()
        if bar {
            path.move(to: pt(34, 60))
            path.addLine(to: pt(66, 60))
        } else {
            path.move(to: pt(22, 82))
            path.addLine(to: pt(50, 18))
            path.addLine(to: pt(78, 82))
        }
        return path
    }
}
