import SwiftUI

/// The Aarogyam patient app: one graph for the process, the screen the session calls for.
@main
struct AarogyamPatientApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(app: app)
                .privacyShield()
                .task { await app.start() }
        }
    }
}
