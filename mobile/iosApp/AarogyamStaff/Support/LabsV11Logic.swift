import AarogyamShared
import Foundation

func l11(_ key: String.LocalizationValue) -> String { String(localized: key, table: "LabsV11") }
func l11f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: l11(key), arguments: args) }

/// Lab tracker, vendor line and batch-reminder text (B7).
enum LabsV11 {
    enum Step: Equatable { case done, current, todo }

    /// The five tracker steps for a case at `current` (0 to 4, nil for none): done before it, current at it, to come after.
    static func steps(current: Int?) -> [Step] {
        (0..<5).map { index in
            guard let current else { return .todo }
            return index < current ? .done : index == current ? .current : .todo
        }
    }

    static func stageTitle(_ index: Int) -> String {
        switch index {
        case 0: l11("lv.stage.impression")
        case 1: l11("lv.stage.production")
        case 2: l11("lv.stage.trial")
        case 3: l11("lv.stage.final")
        default: l11("lv.stage.delivered")
        }
    }

    /// `Pune · ~5 days · Crown, Aligner`, leaving out what is missing.
    static func vendorLine(city: String?, days: Int?, types: [String]) -> String {
        let place = city.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        let turnaround = days.flatMap { $0 > 0 ? l11f("lv.vendor.days", $0) : nil }
        let work = types.isEmpty ? nil : types.joined(separator: ", ")
        return [place, turnaround, work].compactMap { $0 }.joined(separator: " · ")
    }

    /// Only a `https://wa.me/` link opens; anything else the server sends is ignored.
    static func whatsAppURL(_ text: String?) -> URL? {
        guard let text, let url = URL(string: text), url.scheme == "https", url.host == "wa.me" else { return nil }
        return url
    }

    static func resultTitle(labs: Int) -> String {
        labs == 0 ? l11("lv.result.none") : labs == 1 ? l11("lv.result.one") : l11f("lv.result.many", labs)
    }

    static func skipText(_ item: LabSkipped) -> String {
        switch item.reason {
        case .notAtLab: l11f("lv.skip.not_at_lab", item.number)
        case .noEmail: l11f("lv.skip.no_email", item.number)
        case .noPhone: l11f("lv.skip.no_phone", item.number)
        case .other: l11f("lv.skip.other", item.number)
        }
    }
}

extension LabCase {
    /// The tracker position, 0 to 4; nil when cancelled.
    var trackerIndex: Int? { tracker.flatMap { LabStage.allCases.firstIndex(of: $0) } }
}

extension LabRow {
    var infoLine: String { LabsV11.vendorLine(city: city, days: turnaroundDays?.intValue, types: workTypes) }
}
