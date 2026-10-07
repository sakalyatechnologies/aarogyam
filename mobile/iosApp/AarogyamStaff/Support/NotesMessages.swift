import AarogyamShared
import Foundation
import SakalyaUI

// Copy for the Notes tab. Every string lives in Localizable.xcstrings.

extension NoteStatus {
    var label: String {
        switch self {
        case .draft: String(localized: "notes.status.draft")
        case .signed: String(localized: "notes.status.signed")
        case .conflict: String(localized: "notes.status.conflict")
        case .enteredInError: String(localized: "notes.status.error")
        case .unknown: String(localized: "notes.status.unknown")
        }
    }

    var tone: SkTone {
        switch self {
        case .signed: .success
        case .draft: .warning
        case .conflict, .enteredInError: .danger
        case .unknown: .neutral
        }
    }
}

extension NoteSection {
    var label: String {
        switch self {
        case .subjective: String(localized: "notes.section.subjective")
        case .objective: String(localized: "notes.section.objective")
        case .assessment: String(localized: "notes.section.assessment")
        case .plan: String(localized: "notes.section.plan")
        }
    }
}

extension RichTextProblem {
    var message: String {
        switch self {
        case .html: String(localized: "notes.problem.html")
        case .linkOrImage: String(localized: "notes.problem.link")
        case .code: String(localized: "notes.problem.code")
        case .deepHeading: String(localized: "notes.problem.heading")
        }
    }
}

extension Format {
    /// The toolbar button's spoken name.
    var label: String {
        switch self {
        case .heading: String(localized: "notes.fmt.heading")
        case .bold: String(localized: "notes.fmt.bold")
        case .italic: String(localized: "notes.fmt.italic")
        case .bullets: String(localized: "notes.fmt.bullets")
        case .numbers: String(localized: "notes.fmt.numbers")
        }
    }

    /// What the button shows.
    var symbol: String {
        switch self {
        case .heading: "H"
        case .bold: "B"
        case .italic: "I"
        case .bullets: "•"
        case .numbers: "1."
        }
    }
}

extension VisitNoteView {
    /// `V-7 · SOAP note`.
    var titleText: String {
        let kindText: String =
            switch kind {
            case "progress": String(localized: "notes.kind.progress")
            case "procedure": String(localized: "notes.kind.procedure")
            case "intake": String(localized: "notes.kind.intake")
            case "front_desk": String(localized: "notes.kind.front_desk")
            default: String(localized: "notes.kind.soap")
            }
        return "\(visitNumber) · \(kindText)"
    }

    /// `Dr. Patil · 3 Oct 2026`.
    var byLine: String {
        [author, at.map { ClinicFormat.date(iso: $0.date.isoText) }].compactMap { $0 }.joined(separator: " · ")
    }

    var addendaText: String { String(localized: "notes.addenda \(Int(addendaCount))") }
}

extension SaveProblem {
    var text: String {
        switch onEnum(of: self) {
        case .format(let format): format.problem.message
        case .changed: String(localized: "notes.problem.changed")
        case .failed(let failed): failed.error.message
        }
    }
}
