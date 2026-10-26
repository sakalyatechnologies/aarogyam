import AarogyamShared
import SakalyaUI
import SwiftUI

/// v10 entry points for the front desk. The shell calls `hook` once; `home` is the Desk home itself, for a shell
/// that wants it as a tab (`HomeChoice.deskReachable`).
enum RoutesV10Desk {
    /// Draws nothing; the shell shows `home` in the Today tab when `DeskV10Home.opensDesk` is true.
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10DeskPlaceholder()
    }

    /// The Desk home as a view, for a Desk tab. `onNewPatient` is the intake (T8) callback; nil opens the walk-in sheet.
    static func home(graph: AppGraph, clinic: ClinicContext, onNewPatient: ((String) -> Void)? = nil,
                     onOpenPatient: @escaping (String) -> Void = { _ in }) -> some View {
        DeskHomeScreen(graph: graph, clinic: clinic, onNewPatient: onNewPatient, onOpenPatient: onOpenPatient)
    }
}

enum DeskV10Home {
    /// `HomeChoice.home == Desk`, from the shared pure rule.
    static func opensDesk(permissions: Set<String>) -> Bool {
        HomeChoiceKt.homeChoiceOf(permissions: permissions).home == .desk
    }
}

/// Takes no space and is hidden from VoiceOver; the cover hangs off it.
struct RoutesV10DeskPlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
