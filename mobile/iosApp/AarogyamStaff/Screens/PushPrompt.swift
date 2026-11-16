import AarogyamShared
import SwiftUI
import UserNotifications

/// After sign-in: a short explanation before the system prompt (asked once), and the token request
/// whenever alerts are allowed.
struct PushPromptModifier: ViewModifier {
    let graph: AppGraph
    @State private var asking = false

    func body(content: Content) -> some View {
        content
            .task { await check() }
            .alert(String(localized: "push11.ask.title", table: "PushV11"), isPresented: $asking) {
                Button(String(localized: "push11.ask.allow", table: "PushV11")) { Task { await allow() } }
                Button(String(localized: "push11.ask.later", table: "PushV11"), role: .cancel) {}
            } message: {
                Text(String(localized: "push11.ask.message", table: "PushV11"))
            }
    }

    private func check() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        switch status {
        case .authorized, .provisional, .ephemeral:
            AppDelegate.registerForPush()
        case .notDetermined:
            if graph.preferences.get(key: .pushAsked) == nil { asking = true }
        default:
            break
        }
    }

    private func allow() async {
        graph.preferences.set(key: .pushAsked, value: "1")
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { AppDelegate.registerForPush() }
    }
}

extension View {
    func pushPrompt(graph: AppGraph) -> some View { modifier(PushPromptModifier(graph: graph)) }
}
