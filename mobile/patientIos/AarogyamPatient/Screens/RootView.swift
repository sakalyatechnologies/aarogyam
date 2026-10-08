import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Aarogyam's own Tulsi theme (the app spans clinics), and the screen the session calls for.
struct RootView: View {
    let app: AppModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let dark = colorScheme == .dark
        let theme = SkTheme(palette: dark ? .tulsiDark : .tulsiLight, isDark: dark)
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

    @ViewBuilder private func signed(_ graph: PatientGraph) -> some View {
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
            #if DEBUG && AARO_ENV_Local
            .safeAreaInset(edge: .bottom) { DevSignInPanel(graph: graph) }
            #endif
            .id("sign-in")
        case .signedIn:
            if let me = app.me {
                if me.clinics.isEmpty {
                    NavigationStack { ClinicsScreen(graph: graph, isFirstRun: true) }.id("first-clinic")
                } else {
                    HomeScreen(graph: graph).id("home")
                }
            } else {
                ProgressView()
            }
        }
    }
}
