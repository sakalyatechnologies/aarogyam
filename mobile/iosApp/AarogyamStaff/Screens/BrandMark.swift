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
            Image("BrandMark").resizable().frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .accessibilityHidden(true)
            Text("Aarogyam").font(.headline.weight(.bold))
        }
        .accessibilityElement(children: .ignore)
    }
}

extension View {
    /// Puts the logo and name in the navigation bar's leading corner; a tap runs [onTap] (home).
    func brandMark(onTap: @escaping () -> Void = {}) -> some View {
        toolbar { ToolbarItem(placement: .topBarLeading) { BrandMark(onTap: onTap) } }
    }
}
