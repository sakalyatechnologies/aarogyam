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

    @ObservationIgnored private var watchers: [Task<Void, Never>] = []

    func start() async {
        guard case .starting = phase else { return }
        let config = BuildSettings.current()
        guard let graph = try? await IosAppKt.createAppGraph(config: config) else {
            phase = .notConfigured
            return
        }
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
