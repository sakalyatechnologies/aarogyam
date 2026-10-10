import AarogyamShared
import SakalyaUI

extension TokenStatus {
    var label: String {
        switch self {
        case .waiting, .unknown: String(localized: "queue.status.waiting")
        case .inChair: String(localized: "queue.status.in_chair")
        case .done: String(localized: "queue.status.done")
        case .left: String(localized: "queue.status.left")
        }
    }

    var tone: SkTone {
        switch self {
        case .waiting, .unknown: .warning
        case .inChair: .info
        case .done: .success
        case .left: .neutral
        }
    }
}
