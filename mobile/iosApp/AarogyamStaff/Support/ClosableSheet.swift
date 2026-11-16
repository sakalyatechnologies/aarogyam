import SakalyaUI
import SwiftUI

/// A sheet's content with a Close button in the navigation bar, for sheets whose only exit was a swipe.
private struct ClosableSheet: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    func body(content: Content) -> some View {
        NavigationStack {
            content
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(a11("a11.close")) { dismiss() }
                            .fontWeight(.semibold)
                            .tint(theme.roles.primary.color)
                            .accessibilityIdentifier("sheet.close")
                    }
                }
        }
    }
}

extension View {
    /// Wraps a sheet's content in a navigation bar that carries a Close button.
    func closableSheet() -> some View { modifier(ClosableSheet()) }
}
