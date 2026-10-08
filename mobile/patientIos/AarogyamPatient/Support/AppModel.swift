import AarogyamPatientShared
import Foundation
import Observation

/// Builds the shared graph once and exposes the session and the linked clinics to SwiftUI.
@MainActor
@Observable
final class AppModel {
    enum Phase {
        case starting
        /// The build has no Supabase URL or key.
        case notConfigured
        case ready(PatientGraph)
    }

    private(set) var phase: Phase = .starting
    private(set) var session: SessionState?
    /// The account and its linked clinics, once loaded.
    private(set) var me: PatientMe?

    @ObservationIgnored private var watchers: [Task<Void, Never>] = []

    func start() async {
        guard case .starting = phase else { return }
        guard let graph = try? await IosAppKt.createPatientGraph(config: BuildSettings.current()) else {
            phase = .notConfigured
            return
        }
        session = graph.sessionState.value
        me = graph.directory.me.value
        phase = .ready(graph)
        watchers = [
            Task { [weak self] in
                for await state in graph.sessionState {
                    self?.session = state
                    if case .signedIn = onEnum(of: state) { graph.loadClinics() }
                }
            },
            Task { [weak self] in
                for await loaded in graph.directory.me { self?.me = loaded }
            },
        ]
    }
}
