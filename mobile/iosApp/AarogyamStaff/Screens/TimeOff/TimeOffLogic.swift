import AarogyamShared
import Foundation

/// Plain helpers for Time off: copy and dates. No UI, so tests reach them.
enum TimeOffV10 {
    static func t(_ key: String.LocalizationValue) -> String { String(localized: key, table: "TimeOffV10") }

    static func kindLabel(_ kind: TimeOffKind?) -> String {
        switch kind {
        case .vacation: t("timeoff.kind_vacation")
        case .sick: t("timeoff.kind_sick")
        case .personal: t("timeoff.kind_personal")
        case .other, nil: t("timeoff.kind_other")
        }
    }

    static func statusLabel(_ status: TimeOffStatus) -> String {
        switch status {
        case .pending: t("timeoff.status_pending")
        case .approved: t("timeoff.status_approved")
        case .declined: t("timeoff.status_declined")
        case .cancelled: t("timeoff.status_cancelled")
        }
    }

    /// `YYYY-MM-DD` for [date] in the Gregorian calendar and the given zone (the clinic's, so a day is the clinic's day).
    static func iso(_ date: Date, zone: TimeZone) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// The date for `YYYY-MM-DD`, at noon in [zone] so a zone shift never moves it to another day.
    static func date(_ iso: String, zone: TimeZone) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        return cal.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// `12 Oct 2026` for a day, or the text itself when it is not a date.
    static func dayLabel(_ iso: String, zone: TimeZone, locale: Locale = .current) -> String {
        guard let date = date(iso, zone: zone) else { return iso }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = zone
        f.dateStyle = .medium
        f.timeStyle = .none
        return f.string(from: date)
    }

    /// One day, or `12 Oct 2026 to 14 Oct 2026`.
    static func rangeLabel(first: String, last: String, zone: TimeZone, locale: Locale = .current) -> String {
        let a = dayLabel(first, zone: zone, locale: locale)
        if first == last { return a }
        return String(format: t("timeoff.range"), a, dayLabel(last, zone: zone, locale: locale))
    }

    /// The clinic's zone, UTC when the name is unknown.
    static func zone(_ clinic: ClinicContext) -> TimeZone {
        TimeZone(identifier: clinic.session.clinic.timezone) ?? TimeZone(identifier: "UTC") ?? .current
    }
}
