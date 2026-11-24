import SwiftUI
import UIKit

extension View {
    /// Hides the screen in the app switcher and, in the App Store build, while the screen is recorded or mirrored.
    func privacyShield() -> some View { modifier(PrivacyShield()) }
}

private struct PrivacyShield: ViewModifier {
    @Environment(\.scenePhase) private var phase
    @State private var captured = false

    /// Debug and TestFlight builds may be recorded, for demos and the App Review video (founder, 23 Nov). The App Store
    /// build, where real patients are, stays blank while recording. TestFlight and review installs carry a sandbox receipt.
    static let recordingAllowed: Bool = {
        #if DEBUG
        return true
        #else
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
        #endif
    }()

    func body(content: Content) -> some View {
        let hidden = phase != .active || (captured && !Self.recordingAllowed)
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
