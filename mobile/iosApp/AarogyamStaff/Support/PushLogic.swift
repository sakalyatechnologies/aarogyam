import AarogyamShared
import Foundation

/// Where a tapped push opens. `queue` is the desk board or the doctor's waiting list, both on Today.
enum PushDestination: Equatable {
    case today, queue, tasks, labs
}

/// A tap waiting for MainTabs; the nonce makes two taps on the same screen both count.
struct PushTarget: Equatable {
    let destination: PushDestination
    let nonce = UUID()
}

enum PushLogic {
    /// The 19 kinds the server sends; each has a `push.<kind>` string (checked by a test).
    static let kinds = [
        "booking_requested", "booking_confirmed_auto", "booking_cancelled_by_patient", "booking_conflict",
        "booking_reminder", "booking_escalation", "arrival", "patient_waiting", "send_in", "collect_payment",
        "payment_due", "recall_due", "lab_overdue", "task_due", "task_reminder", "task_escalated",
        "time_off_requested", "time_off_decided", "stock_alert",
    ]

    /// `/today` and anything unknown go to Today (the shared rule, `PushTap.screenFor`).
    static func destination(href: String?) -> PushDestination {
        switch PushTap.companion.screenFor(href: href) {
        case .queue: .queue
        case .tasks: .tasks
        case .labs: .labs
        default: .today
        }
    }

    /// The language the app shows (`en`, `hi` or `mr`), which is the one APNs picks the `loc-key` text in.
    static func localeTag() -> String {
        Bundle.main.preferredLocalizations.first ?? "en"
    }

    /// The device token as lowercase hex. Never logged.
    static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }
}
