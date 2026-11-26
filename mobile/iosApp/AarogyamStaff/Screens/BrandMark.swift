import SwiftUI

/// The app logo and name, at the top left of the main screens.
struct BrandMark: View {
    var body: some View {
        HStack(spacing: 6) {
            Image("BrandMark").resizable().frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                .accessibilityHidden(true)
            Text("Aarogyam").font(.headline.weight(.bold))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Aarogyam")
    }
}

extension View {
    /// Puts the logo and name in the navigation bar's leading corner.
    func brandMark() -> some View {
        toolbar { ToolbarItem(placement: .topBarLeading) { BrandMark() } }
    }
}
