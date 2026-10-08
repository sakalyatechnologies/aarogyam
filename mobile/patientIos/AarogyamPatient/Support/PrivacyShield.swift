import SwiftUI
import UIKit

extension View {
    /// Hides the screen in the app switcher and while the screen is recorded or mirrored.
    func privacyShield() -> some View { modifier(PrivacyShield()) }
}

private struct PrivacyShield: ViewModifier {
    @Environment(\.scenePhase) private var phase
    @State private var captured = false

    func body(content: Content) -> some View {
        let hidden = phase != .active || captured
        content
            .overlay {
                if hidden {
                    Rectangle().fill(.ultraThickMaterial).ignoresSafeArea()
                        .overlay { Image(systemName: "cross.case.fill").font(.largeTitle).foregroundStyle(.secondary) }
                        .accessibilityHidden(true)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { note in
                captured = (note.object as? UIScreen)?.isCaptured ?? false
            }
    }
}
