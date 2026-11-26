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
            // The brand mark: a vector asset that is already rounded.
            Image("BrandMark").resizable().scaledToFit().frame(width: 28, height: 28)
                .accessibilityHidden(true)
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
