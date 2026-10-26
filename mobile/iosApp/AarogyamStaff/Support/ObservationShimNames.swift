import AarogyamShared

/// See ObservationShim.swift: what the `@Observable` macro expansion looks up as `Observation.*`.
enum Observation {
    typealias Observable = SwiftObservable
    typealias ObservationRegistrar = SwiftObservationRegistrar
}
