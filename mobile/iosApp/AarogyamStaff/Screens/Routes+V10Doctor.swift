import AarogyamShared
import SwiftUI

/// v10 entry points for the doctor flow (wrap up and finish a visit). The shell calls `hook` once, so a later
/// screen changes this file only. The "Waiting for you" card lives here: inline at the top of the Today tab, with a banner and a haptic on a new arrival.
enum RoutesV10Doctor {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10DoctorPlaceholder()
    }

    /// The waiting list for the top of the Today tab; draws nothing unless the person's home is Doctor.
    /// `onStart` opens the visit for a patient who has been sent in.
    static func waitingTop(graph: AppGraph, clinic: ClinicContext, onStart: @escaping (VisitRoute) -> Void) -> some View {
        DoctorWaitingHook(graph: graph, clinic: clinic, onStart: onStart)
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10DoctorPlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
