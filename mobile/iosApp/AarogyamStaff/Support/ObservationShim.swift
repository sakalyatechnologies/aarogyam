// The shared module exports a model named `Observation` (a clinical reading), which makes the
// `@Observable` macro's `Observation.Observable` resolve to that class. Naming the module's
// types through the enum in ObservationShimNames.swift, which wins over the import, keeps the
// macro working until the model is renamed in shared. Delete both files when it is.
import protocol Observation.Observable
import struct Observation.ObservationRegistrar

typealias SwiftObservable = Observable
typealias SwiftObservationRegistrar = ObservationRegistrar
