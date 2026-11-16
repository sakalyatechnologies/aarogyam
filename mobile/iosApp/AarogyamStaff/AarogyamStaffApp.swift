import SwiftUI

/// The Aarogyam staff app: one graph for the process, the screen the session calls for.
@main
struct AarogyamStaffApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(app: app)
                .privacyShield()
                .task {
                    delegate.model = app
                    await app.start()
                }
                .onOpenURL { app.handle(url: $0) }
        }
    }
}
