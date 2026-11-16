import AarogyamShared
import Foundation

/// Copy for the v11 Analytics page (AnalyticsV11.xcstrings: en, hi, mr).
func a11(_ key: String.LocalizationValue) -> String { String(localized: key, table: "AnalyticsV11") }

func a11f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: a11(key), arguments: args) }

/// Dates, labels and numbers the Analytics cards draw. The shared holder does the maths; this only formats.
enum AnalyticsFormat {
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = .current
        return calendar
    }

    /// The local date for an ISO day (`2026-10-09`), noon so a time zone shift cannot change the day.
    static func date(iso: String) -> Date {
        let p = iso.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return .now }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) ?? .now
    }

    static func iso(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    static func date(_ day: Kotlinx_datetimeLocalDate) -> Date { date(iso: day.isoText) }

    /// `17 Aug` and `15 Nov 2026`, from and to.
    static func rangeEnds(_ range: AnalyticsRange) -> (from: String, to: String) {
        let from = date(range.from), to = date(range.to)
        let sameYear = calendar.component(.year, from: from) == calendar.component(.year, from: to)
        let short = Date.FormatStyle().day().month(.abbreviated)
        let full = Date.FormatStyle().day().month(.abbreviated).year()
        return (from.formatted(sameYear ? short : full), to.formatted(full))
    }

    static func caption(_ range: AnalyticsRange) -> String {
        let ends = rangeEnds(range)
        let text = "\(ends.from) – \(ends.to)"
        return range.bucket == .week ? a11f("a11.range.caption.week", text) : a11f("a11.range.caption.month", text)
    }

    /// A bucket's label for tooltips and VoiceOver: `17 Aug` for a week, `Sep 2026` for a month.
    static func bucketLabel(_ start: Kotlinx_datetimeLocalDate, bucket: AnalyticsBucketKind) -> String {
        let day = date(start)
        return bucket == .week ? day.formatted(Date.FormatStyle().day().month(.abbreviated)) : day.formatted(Date.FormatStyle().month(.abbreviated).year())
    }

    /// `₹45k`, with a minus sign for a loss.
    static func rupees(paise: Int64) -> String {
        paise < 0 ? "−" + ClinicalFormat.compactRupees(paise: -paise) : ClinicalFormat.compactRupees(paise: paise)
    }

    static func deltaSpeech(_ percent: Int?) -> String {
        guard let percent else { return "" }
        return percent < 0 ? a11f("a11.delta.down", -percent) : a11f("a11.delta.up", percent)
    }

    static func sexName(_ key: String) -> String {
        switch key.lowercased() {
        case "female", "f": a11("a11.sex.female")
        case "male", "m": a11("a11.sex.male")
        case "other": a11("a11.sex.other")
        case "unknown": a11("a11.sex.unknown")
        default: ClinicalFormat.keyText(key)
        }
    }

    /// `18_34` as `18–34`, `65_plus` as `65+`.
    static func ageBand(_ key: String) -> String {
        if key.hasSuffix("_plus") { return key.replacingOccurrences(of: "_plus", with: "+") }
        return key.replacingOccurrences(of: "_", with: "–")
    }

    static func sliceName(_ key: String) -> String {
        switch key {
        case "treatment": a11("a11.split.treatment")
        case "consult": a11("a11.split.consult")
        default: a11("a11.split.admin")
        }
    }
}
