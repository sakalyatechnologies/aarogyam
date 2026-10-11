import AarogyamShared
import SakalyaUI
import SwiftUI

// The words and tones of the note's kinds, save states and dictation languages, shared by the
// one-screen visit in `Screens/V9Visit`.

extension BulletKind {
    /// The kinds a person picks when typing; Dictated only comes from the microphone.
    static let userKinds: [BulletKind] = [.complaint, .finding, .advice]

    var label: String {
        switch self {
        case .complaint: CL("c.visit.kind.complaint")
        case .finding: CL("c.visit.kind.finding")
        case .advice: CL("c.visit.kind.advice")
        case .dictated: CL("c.visit.kind.dictated")
        }
    }

    var tone: SkTone {
        switch self {
        case .complaint: .warning
        case .finding: .info
        case .advice: .success
        case .dictated: .brand
        }
    }
}

extension NoteSave {
    var label: String {
        switch self {
        case .empty: CL("c.visit.save.empty")
        case .unsaved: CL("c.visit.save.unsaved")
        case .saving: CL("c.visit.save.saving")
        case .saved: CL("c.visit.save.saved")
        case .signed: CL("c.visit.save.signed")
        case .failed: CL("c.visit.save.failed")
        }
    }

    var tone: SkTone {
        switch self {
        case .empty: .neutral
        case .unsaved, .saving: .warning
        case .saved, .signed: .success
        case .failed: .danger
        }
    }
}

extension DictationLanguage {
    /// The chip text: each language in its own script.
    var chipLabel: String {
        switch self {
        case .english: "English"
        case .hindi: "हिन्दी"
        case .marathi: "मराठी"
        }
    }
}
