import AarogyamShared
import Observation
import SwiftUI

/// One screen's state holder and its latest state, alive while the screen is shown.
@MainActor
@Observable
final class ScreenModel<Holder: AnyObject, Value: AnyObject> {
    let holder: Holder
    private(set) var value: Value
    @ObservationIgnored private let scope = ScreenScope()
    @ObservationIgnored private var watcher: Task<Void, Never>?

    init(make: (ScreenScope) -> Holder, state: (Holder) -> SkieSwiftStateFlow<Value>) {
        holder = make(scope)
        let flow = state(holder)
        value = flow.value
        watcher = Task { [weak self] in
            for await next in flow { self?.value = next }
        }
    }

    isolated deinit {
        watcher?.cancel()
        scope.close()
    }
}

/// Creates a screen's state holder once, when the screen appears, and renders its state.
struct ScreenHost<Holder: AnyObject, Value: AnyObject, Content: View>: View {
    let make: (ScreenScope) -> Holder
    let state: (Holder) -> SkieSwiftStateFlow<Value>
    @ViewBuilder let content: (Holder, Value) -> Content
    @State private var model: ScreenModel<Holder, Value>?

    var body: some View {
        ZStack {
            if let model { content(model.holder, model.value) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            if model == nil { model = ScreenModel(make: make, state: state) }
        }
    }
}
