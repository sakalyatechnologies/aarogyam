import AarogyamShared
import Foundation

/// ISO dates (`2026-10-09`) to and from the shared module's LocalDate, which Swift cannot build directly.
enum IosDates {
    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    /// Days since 1970-01-01 for [iso]; 0 when it does not parse.
    static func epochDays(_ iso: String) -> Int {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        let calendar = utc
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return 0 }
        return Int((date.timeIntervalSince1970 / 86_400).rounded(.down))
    }

    static func parse(_ iso: String) -> Kotlinx_datetimeLocalDate {
        Kotlinx_datetimeLocalDate.companion.fromEpochDays(epochDays: Int32(epochDays(iso)))
    }

    /// Today's ISO date on the wall clock of [zone] (the clinic's time zone).
    static func todayISO(zone: String, now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }
}
