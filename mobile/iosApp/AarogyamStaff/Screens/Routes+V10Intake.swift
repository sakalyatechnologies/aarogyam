import AarogyamShared
import SwiftUI

/// v10 entry points for the intake form (the new-patient form and its files). The shell calls `hook` once, so a later
/// screen changes this file only. Until then it draws nothing.
enum RoutesV10Intake {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10IntakePlaceholder()
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10IntakePlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
