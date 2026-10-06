import AarogyamShared
import SakalyaUI
import SwiftUI

/// Themes the app from the open clinic's brand and shows the screen the session calls for.
struct RootView: View {
    let app: AppModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let branding = app.clinic?.branding ?? ClinicBranding.companion.Default
        let theme = branding.skTheme(systemDark: colorScheme == .dark)
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.palette.background.color.ignoresSafeArea())
            .tint(theme.palette.primaryText.color)
            .skTheme(theme)
    }

    @ViewBuilder private var content: some View {
        switch app.phase {
        case .starting:
            ProgressView()
        case .notConfigured:
            SkEmptyState(String(localized: "not_configured.title"), message: String(localized: "not_configured.message"))
        case .ready(let graph):
            signed(graph)
        }
    }

    @ViewBuilder private func signed(_ graph: AppGraph) -> some View {
        switch app.session.map({ onEnum(of: $0) }) {
        case nil, .restoring:
            ProgressView()
        case .storageUnavailable:
            SkEmptyState(
                String(localized: "storage_unavailable.title"),
                message: String(localized: "storage_unavailable.message"),
                actionTitle: String(localized: "try_again"),
                action: graph.restore
            )
        case .signedOut:
            ScreenHost(make: { graph.signIn(screen: $0) }, state: { $0.state }) { holder, state in
                SignInScreen(holder: holder, state: state)
            }
            .onAppear { app.choseToLeave = false }
            #if DEBUG && AARO_ENV_Local
            .safeAreaInset(edge: .bottom) { DevSignInPanel(graph: graph) }
            #endif
            .id("sign-in")
        case .signedIn:
            if let clinic = app.clinic {
                MainTabs(
                    graph: graph,
                    clinic: clinic,
                    onSwitchClinic: {
                        app.choseToLeave = true
                        graph.directory.leave()
                    }
                )
                .id("main-\(clinic.slug)")
            } else {
                let autoOpen = !app.choseToLeave
                NavigationStack {
                    ScreenHost(make: { graph.clinicPicker(screen: $0, autoOpenSingle: autoOpen) }, state: { $0.state }) { holder, state in
                        ClinicPickerScreen(holder: holder, state: state, onSignOut: graph.signOut)
                    }
                }
                .id("clinics")
            }
        }
    }
}
