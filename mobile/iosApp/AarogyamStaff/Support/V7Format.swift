import Foundation

extension ClinicFormat {
    /// `Mon`, from an ISO date.
    static func weekdayShort(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        var style = Date.FormatStyle(locale: locale, timeZone: calendar.timeZone).weekday(.abbreviated)
        style.calendar = calendar
        return date.formatted(style)
    }
}
