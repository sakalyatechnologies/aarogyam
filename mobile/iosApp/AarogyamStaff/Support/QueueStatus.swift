import AarogyamShared
import SakalyaUI

extension TokenStatus {
    var label: String {
        switch self {
        case .waiting, .unknown: String(localized: "queue.status.waiting")
        case .called: String(localized: "queue.status.called")
        case .inChair: String(localized: "queue.status.in_chair")
        case .readyToBill: String(localized: "queue.status.ready_to_bill")
        case .done: String(localized: "queue.status.done")
        case .left: String(localized: "queue.status.left")
        }
    }

    var tone: SkTone {
        switch self {
        case .waiting, .unknown: .warning
        case .called: .brand
        case .inChair: .info
        case .readyToBill: .success
        case .done: .success
        case .left: .neutral
        }
    }
}
