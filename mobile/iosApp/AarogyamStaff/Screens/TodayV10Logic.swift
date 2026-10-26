import Foundation
import AarogyamShared

/// What the Today tab shows, decided from permissions alone so it can be tested.
enum TodayV10Logic {
    /// The Desk home replaces the Today list for a person whose home is the Desk.
    static func usesDesk(permissions: Set<String>) -> Bool { DeskV10Home.opensDesk(permissions: permissions) }

    /// The My tasks button shows only for a role that may use tasks.
    static func showsTasks(permissions: Set<String>) -> Bool { permissions.contains("tasks.use") }
}

/// A new-patient form asked for from the Desk home; one value per opening.
struct IntakeRequest: Identifiable {
    let id = UUID()
    let phone: String
}
