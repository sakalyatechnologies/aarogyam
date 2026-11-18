import Foundation
import AarogyamShared

/// What the Today tab shows, decided from permissions alone so it can be tested.
enum TodayV10Logic {
    /// The Desk home replaces the Today list for a person whose home is the Desk.
    static func usesDesk(permissions: Set<String>) -> Bool { DeskV10Home.opensDesk(permissions: permissions) }

    /// The role may use tasks (a tapped task alert opens them).
    static func showsTasks(permissions: Set<String>) -> Bool { permissions.contains("tasks.use") }

    /// The My tasks button on the home: front desk and assistants, not doctors and owners (shared rule).
    static func showsTasksOnHome(permissions: Set<String>) -> Bool { HomeChoiceKt.showsTasksOnHome(permissions: permissions) }
}

/// A new-patient form asked for from the Desk home; one value per opening.
struct IntakeRequest: Identifiable {
    let id = UUID()
    let phone: String
    /// People already on the number, whom the new patient can be linked to (`family_of`).
    var family: [DeskFamilyAnchor] = []
}
