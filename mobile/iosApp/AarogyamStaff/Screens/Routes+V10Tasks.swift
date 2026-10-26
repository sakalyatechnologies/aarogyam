import AarogyamShared
import SwiftUI

/// v10 entry points for the My tasks (the staff task list). The shell calls `hook` once, so a later
/// screen changes this file only. Until then it draws nothing.
enum RoutesV10Tasks {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10TasksPlaceholder()
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10TasksPlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
