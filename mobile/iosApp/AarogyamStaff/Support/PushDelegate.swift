import AarogyamShared
import os
import UIKit
import UserNotifications

/// Registers for remote notifications, hands the token to the shared registration, shows banners in
/// front and routes a tap. Logs codes only: never the token or a notification's text.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private let log = Logger(subsystem: "com.aarogyam.staff", category: "push")
    /// Set by the app once its model exists; a token or tap that came first waits here.
    weak var model: AppModel? { didSet { flush() } }
    private var token: String?
    private var tap: PushTap?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        log.info("push.token_received")
        token = PushLogic.hex(deviceToken)
        flush()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        log.warning("push.register_failed code=\((error as NSError).code)")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        tap = PushTap.companion.of(userInfo: response.notification.request.content.userInfo)
        log.info("push.tapped")
        flush()
    }

    private func flush() {
        guard let model else { return }
        if let token { model.receive(token: token) }
        if let tap { self.tap = nil; model.receive(tap: tap) }
    }

    /// Asks iOS for a token; only called once the person is signed in and has allowed alerts.
    static func registerForPush() {
        UIApplication.shared.registerForRemoteNotifications()
    }
}
