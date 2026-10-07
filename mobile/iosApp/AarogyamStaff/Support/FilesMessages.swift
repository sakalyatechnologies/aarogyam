import AarogyamShared
import Foundation

// Copy for the Files tab. Every string lives in Localizable.xcstrings.

extension UploadProblem {
    var message: String {
        switch self {
        case .labelTooLong: String(localized: "files.problem.label")
        case .badTooth: String(localized: "files.problem.tooth")
        case .tooLarge: String(localized: "files.problem.large")
        case .failed: String(localized: "files.problem.failed")
        }
    }
}
