import AarogyamShared
import Foundation

/// The v7 Today's mapping and formatting rules, kept apart from the views so they can be tested.
enum TodayV7 {
    /// `10:45`: the mock-up's 12-hour clock without a period, for schedule rows and chips.
    static func clock(minuteOfDay: Int) -> String {
        let hour = minuteOfDay / 60 % 12
        return String(format: "%d:%02d", hour == 0 ? 12 : hour, minuteOfDay % 60)
    }

    /// One cell of the week strip in My schedule.
    struct WeekDay: Equatable {
        let letter: String
        let number: Int
        let isToday: Bool
    }

    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    /// Monday to Sunday of the week holding [iso] (`2026-10-09`), with the narrow weekday letter.
    static func weekStrip(iso: String, locale: Locale = .current) -> [WeekDay] {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        let calendar = utc
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return [] }
        let weekday = calendar.component(.weekday, from: date)
        let sinceMonday = (weekday + 5) % 7
        return (0..<7).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset - sinceMonday, to: date) else { return nil }
            var style = Date.FormatStyle(locale: locale, timeZone: calendar.timeZone).weekday(.narrow)
            style.calendar = calendar
            return WeekDay(letter: day.formatted(style), number: calendar.component(.day, from: day), isToday: offset == sinceMonday)
        }
    }

    /// `October 2026`, from an ISO date.
    static func monthYear(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        let calendar = utc
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        var style = Date.FormatStyle(locale: locale, timeZone: calendar.timeZone).month(.wide).year()
        style.calendar = calendar
        return date.formatted(style)
    }

    /// `Saturday 10 October`, from an ISO date (the kicker above the title).
    static func longDay(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        let calendar = utc
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "EEEE d MMMM"
        return formatter.string(from: date)
    }

    /// The member's day: how many of their visits are done, or nil when they have none.
    static func dayProgress(total: Int, remaining: Int) -> (done: Int, total: Int, fraction: Double)? {
        guard total > 0 else { return nil }
        let done = min(max(total - remaining, 0), total)
        return (done, total, Double(done) / Double(total))
    }

    /// Visits still to come (not the hero), soonest first, for the Up next carousel.
    static func upNext(_ schedule: [ScheduleItem], excluding hero: ScheduleItem?, limit: Int = 4) -> [ScheduleItem] {
        schedule
            .filter { $0.appointmentId != hero?.appointmentId && [.booked, .confirmed, .arrived].contains($0.status) }
            .prefix(limit)
            .map { $0 }
    }

    /// The pill a schedule row ends with: its look (a theme role pair) and label key.
    enum Pill: Equatable {
        case done, inChair, waiting, missed, booked

        init(_ status: VisitStatus) {
            switch status {
            case .completed: self = .done
            case .inChair: self = .inChair
            case .arrived: self = .waiting
            case .noShow, .cancelled: self = .missed
            default: self = .booked
            }
        }

        var label: String {
            switch self {
            case .done: String(localized: "t7.pill.done", table: "TodayV7")
            case .inChair: String(localized: "t7.pill.in_chair", table: "TodayV7")
            case .waiting: String(localized: "t7.pill.waiting", table: "TodayV7")
            case .missed: String(localized: "t7.pill.missed", table: "TodayV7")
            case .booked: String(localized: "t7.pill.booked", table: "TodayV7")
            }
        }
    }

    /// The me card's chips: patients for a doctor (and their two most common treatments), or the
    /// waiting count for everyone else, plus "On leave today".
    static func meChips(isDoctor: Bool, remaining: Int, treatments: [(name: String, count: Int)], waiting: Int, onLeave: Bool) -> [String] {
        var chips: [String] = []
        if isDoctor {
            chips.append(String(localized: "t7.me.for_you \(remaining)", table: "TodayV7"))
            chips += treatments.prefix(2).map { "\($0.count) \($0.name)" }
        } else {
            chips.append(String(localized: "t7.me.waiting \(waiting)", table: "TodayV7"))
        }
        if onLeave { chips.append(String(localized: "t7.me.on_leave", table: "TodayV7")) }
        return chips
    }

    /// The title of a "Needs attention" row.
    static func attentionTitle(kind: AttentionKind, minutes: Int) -> String {
        switch kind {
        case .lateArrival: String(localized: "t7.attention.late \(minutes)", table: "TodayV7")
        case .longWait: String(localized: "t7.attention.wait \(minutes)", table: "TodayV7")
        default: String(localized: "t7.attention.other", table: "TodayV7")
        }
    }

    /// The title of a notification row, by the kind the server sends.
    static func notificationTitle(kind: String) -> String {
        switch kind {
        case "booking_requested": String(localized: "t7.notif.requested", table: "TodayV7")
        case "booking_confirmed_auto": String(localized: "t7.notif.confirmed", table: "TodayV7")
        case "booking_cancelled_by_patient": String(localized: "t7.notif.cancelled", table: "TodayV7")
        default: String(localized: "t7.notifications", table: "TodayV7")
        }
    }

    /// The clinic's public booking page, which the Clinic QR points to.
    static func bookingURL(origin: String) -> String? {
        let base = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        return base.isEmpty ? nil : base + "/book"
    }
}
