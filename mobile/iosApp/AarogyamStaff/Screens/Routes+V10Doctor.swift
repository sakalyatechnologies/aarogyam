import AarogyamShared
import SwiftUI

/// v10 entry points for the doctor flow (wrap up and finish a visit). The shell calls `hook` once, so a later
/// screen changes this file only. Until then it draws nothing.
enum RoutesV10Doctor {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10DoctorPlaceholder()
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10DoctorPlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
