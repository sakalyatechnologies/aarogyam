import AarogyamShared
import Foundation
import SakalyaUI

// Copy for the prescription states and enums. Every string lives in Localizable.xcstrings.

extension RxStatus {
    var label: String {
        switch self {
        case .draft: String(localized: "rx.status.draft")
        case .issued: String(localized: "rx.status.issued")
        case .cancelled: String(localized: "rx.status.cancelled")
        case .unknown: String(localized: "rx.status.unknown")
        }
    }

    var tone: SkTone {
        switch self {
        case .issued: .success
        case .draft: .warning
        case .cancelled: .danger
        case .unknown: .neutral
        }
    }
}

enum RxFormat {
    /// `1 day`, `5 days`.
    static func days(_ count: Int) -> String { String(localized: "rx.days \(count)") }
}

extension RxMedicine {
    /// `1 capsule · 1-0-1 · 5 days`, leaving out what the prescription doesn't say.
    var detailText: String {
        [dose, frequency, durationDays.map { RxFormat.days($0.intValue) }].compactMap { $0 }.joined(separator: " · ")
    }
}

extension RxSummary {
    /// `RX-412 · 3 Oct 2026`.
    var titleText: String {
        [number, at.map { ClinicFormat.date(iso: $0.date.isoText) }].compactMap { $0 }.joined(separator: " · ")
    }
}

extension AllergyWarning {
    var text: String { String(format: String(localized: "rx.allergy_warning"), drug, substance, severity.label) }
}

extension DrugView {
    var subtitleText: String { [brand, strength, form].compactMap { $0 }.joined(separator: " · ") }
}

extension ShareView {
    /// What goes beside the link in the OS share sheet: the clinic and nothing about the patient or
    /// the medicines. The PIN is read out, never sent with the link.
    func shareMessage(clinic: String) -> String { String(format: String(localized: "rx.share.text"), clinic) }
}
