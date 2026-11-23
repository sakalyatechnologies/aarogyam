import AarogyamShared
import Foundation

/// Plain helpers for My tasks and the bell's notification kinds; no UI, so tests reach them.
enum TasksV10 {
    static func t(_ key: String.LocalizationValue) -> String { String(localized: key, table: "TasksV10") }

    /// The SF Symbol for an icon name from the shared set; anything else is the message bubble.
    static func symbol(_ icon: String) -> String {
        switch icon {
        case "clock": "clock"
        case "bell": "bell"
        case "check": "checkmark.circle"
        case "alert": "exclamationmark.triangle"
        case "calendar": "calendar"
        case "box": "shippingbox"
        default: "bubble.left"
        }
    }

    /// The localized title for a kind's `titleKey`, from the table its prefix names.
    static func title(key: String) -> String {
        let table = key.hasPrefix("d9.") ? "DeskV9" : key.hasPrefix("t7.") ? "TodayV7" : "TasksV10"
        return String(localized: String.LocalizationValue(key), table: table)
    }

    static func notificationTitle(kind: String) -> String {
        let info = NotificationKinds.shared.of(kind: kind)
        let key = info.known || info.titleKey == "v10.notif.generic" ? info.titleKey : "v10.notif.generic"
        return title(key: key)
    }

    static func notificationSymbol(kind: String) -> String { symbol(NotificationKinds.shared.of(kind: kind).icon) }

    /// `Due 4:30 pm`, with the day when it is not today; in the given zone (the device's by default).
    static func dueLabel(_ iso: String, zone: TimeZone = .current, now: Date = Date(), locale: Locale = .current) -> String? {
        guard let date = parse(iso) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = zone
        f.setLocalizedDateFormatFromTemplate(cal.isDate(date, inSameDayAs: now) ? "jmm" : "dMMMjmm")
        return String(format: t("tasks10.due"), f.string(from: date))
    }

    static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso)
    }

    static func emptyLabel() -> String { t("tasks10.empty") }
    static func overdueLabel() -> String { t("tasks10.overdue") }
    static func openLabel(_ count: Int) -> String { String(format: t("tasks10.open_count"), count) }
    static func photosLabel(_ count: Int) -> String { String(format: t("tasks10.photos"), count) }

    /// Whole units from the quantity field; nil for blank, zero or anything else.
    static func quantity(_ text: String) -> Int64? {
        guard let n = Int64(text.trimmingCharacters(in: .whitespaces)), n > 0 else { return nil }
        return n
    }
}

/// A bell row's colour family (redesign A); the view maps each to a theme role.
enum NotificationTint: Equatable {
    case queue, money, booking, clinical, neutral
}

/// The bell's segmented filter.
enum NotificationFilter: CaseIterable, Hashable {
    case all, unread, queue, bookings
}

extension TasksV10 {
    /// Queue rows teal, money warm, bookings indigo, clinical rose, the rest neutral.
    static func notificationTint(kind: String) -> NotificationTint {
        if kind == "collect_payment" { return .money }
        switch NotificationKinds.shared.of(kind: kind).category {
        case .queue: return .queue
        case .payment: return .money
        case .booking, .timeOff: return .booking
        case .lab, .recall, .patient: return .clinical
        default: return .neutral
        }
    }

    static func matches(_ filter: NotificationFilter, kind: String, read: Bool) -> Bool {
        switch filter {
        case .all: true
        case .unread: !read
        case .queue: NotificationKinds.shared.of(kind: kind).category == .queue
        case .bookings: NotificationKinds.shared.of(kind: kind).category == .booking
        }
    }

    /// True when `iso` falls on the same calendar day as `now`; an unreadable time is Earlier.
    static func isToday(_ iso: String, now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let date = parse(iso) else { return false }
        return calendar.isDate(date, inSameDayAs: now)
    }

    /// `5 min ago` today, `Yesterday`, a weekday within the week, else `12 Nov`; localized by the system.
    static func notificationTime(_ iso: String, now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let date = parse(iso) else { return nil }
        if calendar.isDate(date, inSameDayAs: now) {
            let f = RelativeDateTimeFormatter()
            f.locale = locale
            f.calendar = calendar
            f.unitsStyle = .short
            f.dateTimeStyle = .named
            return f.localizedString(for: min(date, now), relativeTo: now)
        }
        let f = DateFormatter()
        f.locale = locale
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        if isYesterday(date, now: now, calendar: calendar) {
            f.dateStyle = .medium
            f.timeStyle = .none
            f.doesRelativeDateFormatting = true
        } else if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day,
                  days >= 0, days < 7 {
            f.setLocalizedDateFormatFromTemplate("EEE")
        } else {
            f.setLocalizedDateFormatFromTemplate("dMMM")
        }
        return f.string(from: date)
    }

    private static func isYesterday(_ date: Date, now: Date, calendar: Calendar) -> Bool {
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: now) else { return false }
        return calendar.isDate(date, inSameDayAs: yesterday)
    }
}
