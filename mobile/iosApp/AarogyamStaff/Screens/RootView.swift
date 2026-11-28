import AarogyamShared
import SakalyaUI
import SwiftUI

/// Themes the app from the open clinic's brand and shows the screen the session calls for.
struct RootView: View {
    let app: AppModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    /// Light or dark as picked in More (nil follows the phone).
    @State private var scheme: ColorScheme?
    /// The branded launch plays once per cold start; it lifts away when the app is ready.
    @State private var launch = LaunchStage.showing
    @State private var launchStart = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let branding = app.clinic?.branding ?? ClinicBranding.companion.Default
        let theme = branding.skTheme(systemDark: colorScheme == .dark)
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(theme.palette.background.color.ignoresSafeArea())
            .opacity(launch == .showing ? 0 : 1)
            .scaleEffect(launch == .showing && !reduceMotion ? 0.98 : 1)
            .animation(.easeOut(duration: reduceMotion ? 0.15 : 0.35), value: launch)
            .overlay {
                if launch != .gone {
                    // The hold counts from the mark's first frame, so a slow first frame never skips the animation.
                    LaunchView(leaving: launch == .leaving).allowsHitTesting(launch == .showing).onAppear { launchStart = Date() }
                }
            }
            .task(id: waiting) {
                guard !waiting, launch == .showing else { return }
                // Hold a fast restore just long enough for the mark to rise and the wordmark to land (1.2 s).
                var hold = reduceMotion ? 0.4 : 1.2
                #if DEBUG
                // `-launchHold` keeps the mark up for 30 s, to look at the animation on a slow machine.
                if ProcessInfo.processInfo.arguments.contains("-launchHold") { hold = 30 }
                #endif
                let rest = hold - Date().timeIntervalSince(launchStart)
                if rest > 0 { try? await Task.sleep(for: .seconds(rest)) }
                launch = .leaving
                try? await Task.sleep(for: .milliseconds(400))
                launch = .gone
            }
            .tint(theme.palette.primaryText.color)
            .skTheme(theme)
            .preferredColorScheme(scheme)
            .task(id: graphID) {
                guard case .ready(let graph) = app.phase else { return }
                for await next in graph.appearance.state { scheme = next.colorScheme }
            }
            // Polls run only while the app is in front (founder decision, 29 Oct 2026).
            .onChange(of: scenePhase, initial: true) { _, phase in AppForeground.shared.set(inFront: phase == .active) }
    }

    /// True while the app is still starting or restoring the session.
    private var waiting: Bool {
        switch app.phase {
        case .starting: return true
        case .ready:
            guard let session = app.session else { return true }
            if case .restoring = onEnum(of: session) { return true }
            return false
        default: return false
        }
    }

    /// Restarts the appearance watch when the graph changes.
    private var graphID: ObjectIdentifier? {
        if case .ready(let graph) = app.phase { return ObjectIdentifier(graph) }
        return nil
    }

    @ViewBuilder private var content: some View {
        switch app.phase {
        case .starting:
            if launch == .gone { ProgressView() }
        case .notConfigured:
            SkEmptyState(String(localized: "not_configured.title"), message: String(localized: "not_configured.message"))
        case .ready(let graph):
            signed(graph)
            #if DEBUG && AARO_ENV_Local
            .task { await DevSession.applyLaunchEnv(graph: graph) }
            #endif
        }
    }

    @ViewBuilder private func signed(_ graph: AppGraph) -> some View {
        switch app.session.map({ onEnum(of: $0) }) {
        case nil, .restoring:
            if launch == .gone { ProgressView() }
        case .storageUnavailable:
            SkEmptyState(
                String(localized: "storage_unavailable.title"),
                message: String(localized: "storage_unavailable.message"),
                actionTitle: String(localized: "try_again"),
                action: graph.restore
            )
        case .signedOut:
            RoutesA.signedOut(graph: graph, app: app)
            .onAppear { app.choseToLeave = false }
            #if DEBUG && AARO_ENV_Local
            .safeAreaInset(edge: .bottom) { DevSignInPanel(graph: graph) }
            #endif
            .id("sign-in")
        case .signedIn:
            if let link = app.pendingInvite {
                RoutesA.joinInvite(graph: graph, link: link) { app.pendingInvite = nil }.id("invite")
            } else if let clinic = app.clinic {
                MainTabs(
                    graph: graph,
                    clinic: clinic,
                    pushTarget: Binding(get: { app.pushTarget }, set: { app.pushTarget = $0 }),
                    onSwitchClinic: {
                        app.choseToLeave = true
                        graph.directory.leave()
                    }
                )
                .id("main-\(clinic.slug)")
                .pushPrompt(graph: graph)
                .overlay(alignment: .top) { RoutesV10Live.hook(graph: graph, clinic: clinic) }
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

private enum LaunchStage { case showing, leaving, gone }
