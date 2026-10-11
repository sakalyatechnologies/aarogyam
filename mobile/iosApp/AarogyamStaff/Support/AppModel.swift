import AarogyamShared
import Foundation
import Observation

/// Builds the shared app graph once and exposes the session and the open clinic to SwiftUI.
@MainActor
@Observable
final class AppModel {
    enum Phase {
        case starting
        /// The build has no Supabase URL or key.
        case notConfigured
        case ready(AppGraph)
    }

    private(set) var phase: Phase = .starting
    private(set) var session: SessionState?
    private(set) var clinic: ClinicContext?
    /// After the person leaves a clinic, the picker waits for a tap even with only one clinic.
    var choseToLeave = false
    /// An invitation link (opened as `aarogyam://invite#...` or pasted) waiting for sign-in and Join.
    var pendingInvite: String?

    @ObservationIgnored private let speech = SpeechDictation()
    @ObservationIgnored private var watchers: [Task<Void, Never>] = []

    /// Takes a URL the system opened the app with; only `aarogyam://invite#<token>` links count.
    func handle(url: URL) {
        guard url.scheme == "aarogyam", url.host == "invite", InviteLink.shared.parse(text: url.absoluteString) != nil else { return }
        pendingInvite = url.absoluteString
    }

    func start() async {
        guard case .starting = phase else { return }
        let config = BuildSettings.current()
        guard let graph = try? await IosAppKt.createAppGraph(config: config, dictation: speech) else {
            phase = .notConfigured
            return
        }
        #if DEBUG && AARO_ENV_Local
        // Screenshot runs: `SIMCTL_CHILD_AAROGYAM_DEV_SIGN_OUT=1` starts from the signed-out screens.
        if ProcessInfo.processInfo.environment["AAROGYAM_DEV_SIGN_OUT"] != nil { graph.signOut() }
        #endif
        session = graph.sessionState.value
        clinic = graph.directory.current.value
        phase = .ready(graph)
        watchers = [
            Task { [weak self] in
                for await state in graph.sessionState { self?.session = state }
            },
            Task { [weak self] in
                for await open in graph.directory.current { self?.clinic = open }
            },
        ]
    }
}
