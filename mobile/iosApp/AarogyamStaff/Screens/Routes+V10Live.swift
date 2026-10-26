import AarogyamShared
import SwiftUI

/// v10 live updates: banners and haptics fed by the shared `LiveUpdates`. The root calls
/// `hook` once, so a later screen changes this file only. Until then it draws nothing.
enum RoutesV10Live {
    @ViewBuilder static func hook(graph: AppGraph) -> some View {
        RoutesV10LivePlaceholder()
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10LivePlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
