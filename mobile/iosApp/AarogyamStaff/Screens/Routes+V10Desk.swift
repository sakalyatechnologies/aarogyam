import AarogyamShared
import SakalyaUI
import SwiftUI

/// v10 entry points for the front desk. The shell calls `hook` once; `home` is the Desk home itself, for a shell
/// that wants it as a tab (`HomeChoice.deskReachable`).
enum RoutesV10Desk {
    /// Shows the Desk home over the tabs for a person whose home is the Desk (`HomeChoice.home == Desk`, by permission).
    /// Everyone else gets the zero-size placeholder.
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        if DeskV10Home.opensDesk(permissions: clinic.permissions) {
            DeskHomeCover(graph: graph, clinic: clinic)
        } else {
            RoutesV10DeskPlaceholder()
        }
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

/// Full-screen Desk home on launch for a Desk person; "Open all tabs" returns to the tab bar.
private struct DeskHomeCover: View {
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var open = true

    var body: some View {
        RoutesV10DeskPlaceholder()
            .fullScreenCover(isPresented: $open) {
                NavigationStack {
                    DeskHomeScreen(graph: graph, clinic: clinic)
                        .navigationTitle(dx("dx.home.title"))
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button(dx("dx.home.open_tabs")) { open = false }
                                    .accessibilityLabel(dx("dx.home.open_tabs.a11y"))
                            }
                        }
                }
            }
    }
}
