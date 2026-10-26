import Network
import Observation

/// The phone's connection, for the offline banner.
@MainActor
@Observable
final class V9Connectivity {
    private(set) var online = true
    @ObservationIgnored private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let ok = path.status == .satisfied
            Task { @MainActor in self?.online = ok }
        }
        monitor.start(queue: DispatchQueue(label: "aarogyam.visit.path"))
    }

    isolated deinit { monitor.cancel() }
}
