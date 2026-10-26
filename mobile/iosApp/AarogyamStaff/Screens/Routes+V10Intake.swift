import AarogyamShared
import SwiftUI

/// v10 entry points for the intake form (the new-patient form and its files). The shell calls `hook` once; it draws nothing.
/// The Desk home opens the form with `screen`.
enum RoutesV10Intake {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10IntakePlaceholder()
    }

    /// The new-patient form; `phone` is prefilled when the desk already typed it. `onDone` runs after "Next patient".
    static func screen(graph: AppGraph, clinic: ClinicContext, phone: String?, onDone: @escaping () -> Void) -> some View {
        IntakeV10Screen(graph: graph, clinic: clinic, phone: phone, onDone: onDone)
    }
}

/// Takes no space and is hidden from VoiceOver.
struct RoutesV10IntakePlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
