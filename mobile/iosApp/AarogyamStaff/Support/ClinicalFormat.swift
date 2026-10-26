import Foundation

/// Copy from `ClinicalV7.xcstrings` (en, hi, mr), the string table of the visit, Rx, Analytics,
/// Expenses and team screens.
func CL(_ key: String.LocalizationValue) -> String { String(localized: key, table: "ClinicalV7") }

/// A formatted copy line: the catalogue entry `key` is a `String(format:)` pattern.
func CLf(_ key: String.LocalizationValue, _ args: CVarArg...) -> String {
    String(format: String(localized: key, table: "ClinicalV7"), arguments: args)
}

/// Pure formatting and mapping for the clinical screens (tested in `ClinicalFormatTests`).
enum ClinicalFormat {
    /// The running visit timer: `7:05`, or `1:02:09` past an hour. Never negative.
    static func timer(seconds: Int) -> String {
        let s = max(seconds, 0)
        let h = s / 3600, m = (s % 3600) / 60, r = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, r) : String(format: "%d:%02d", m, r)
    }

    /// `+12%` / `−5%`; nil when there is nothing to compare.
    static func delta(_ percent: Int?) -> String? {
        guard let percent else { return nil }
        return percent < 0 ? "\u{2212}\(-percent)%" : "+\(percent)%"
    }

    /// `₹1.2L`, `₹45k`, `₹800`, from paise (the mockup's `fmtR`).
    static func compactRupees(paise: Int64) -> String {
        let rupees = Double(paise) / 100
        if rupees >= 1e5 { return "₹" + trimmed(rupees / 1e5) + "L" }
        if rupees >= 1e3 { return "₹" + trimmed(rupees / 1e3) + "k" }
        return "₹\(Int(rupees.rounded()))"
    }

    private static func trimmed(_ value: Double) -> String {
        let text = String(format: "%.1f", value)
        return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
    }

    /// `+91 98•••• 4321`: the first two and last four digits of an Indian mobile number.
    static func maskedPhone(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var digits = raw.filter(\.isNumber)
        if digits.count == 12, digits.hasPrefix("91") { digits.removeFirst(2) }
        if digits.count == 11, digits.hasPrefix("0") { digits.removeFirst() }
        guard digits.count == 10 else { return nil }
        return "+91 \(digits.prefix(2))•••• \(digits.suffix(4))"
    }

    /// The digits `wa.me` wants: country code first, no plus; nil when the number is not a mobile.
    static func whatsAppDigits(_ raw: String?) -> String? {
        guard let raw else { return nil }
        var digits = raw.filter(\.isNumber)
        if digits.count == 11, digits.hasPrefix("0") { digits.removeFirst() }
        if digits.count == 10 { digits = "91" + digits }
        return digits.count >= 11 && digits.count <= 15 ? digits : nil
    }

    /// `https://wa.me/<digits>?text=…`; without a number WhatsApp's own chooser opens.
    static func whatsAppURL(phone: String?, text: String) -> URL? {
        let query = text.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? ""
        return URL(string: "https://wa.me/\(whatsAppDigits(phone) ?? "")?text=\(query)")
    }

    /// `sms:<number>&body=…`, the form iOS opens Messages with.
    static func smsURL(phone: String?, text: String) -> URL? {
        let query = text.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? ""
        let number = phone?.filter { $0.isNumber || $0 == "+" } ?? ""
        return URL(string: "sms:\(number)&body=\(query)")
    }

    /// The heat map's rows (Mon to Sun) and columns (the clinic hours that have visits, at least
    /// 9 to 17), each cell 0 to 1 against the busiest cell.
    static func heat(_ cells: [(weekday: Int, hour: Int, visits: Int)]) -> (hours: [Int], loads: [[Double]]) {
        let hours = Array(min(cells.map(\.hour).min() ?? 9, 9)...max(cells.map(\.hour).max() ?? 17, 17))
        let peak = Double(max(cells.map(\.visits).max() ?? 1, 1))
        var loads = Array(repeating: Array(repeating: 0.0, count: hours.count), count: 7)
        for cell in cells where (1...7).contains(cell.weekday) {
            if let column = hours.firstIndex(of: cell.hour) { loads[cell.weekday - 1][column] += Double(cell.visits) / peak }
        }
        return (hours, loads.map { $0.map { min($0, 1) } })
    }

    /// The radar's axes: the biggest visit kinds, at most six; nil under three (a radar needs a shape).
    static func radar(_ kinds: [(key: String, value: Int64)]) -> [(key: String, value: Int64)]? {
        let top = Array(kinds.filter { $0.value > 0 }.sorted { $0.value > $1.value }.prefix(6))
        return top.count >= 3 ? top : nil
    }

    /// A readable form of a server key (`root_canal` becomes `Root canal`).
    static func keyText(_ key: String) -> String {
        let text = key.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// Parses the API's timestamps, with or without fractional seconds.
    static func instant(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return plain.date(from: text) ?? fractional.date(from: text)
    }

    /// A chat bubble's time: `10:42` today, `Mon 10:42` within the week, else `5 Oct`.
    static func chatTime(_ text: String, now: Date = .now, zone: TimeZone = .current, locale: Locale = .current) -> String {
        guard let date = instant(text) else { return "" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let time = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, timeZone: zone))
        if calendar.isDate(date, inSameDayAs: now) { return time }
        if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day, days < 7 {
            return date.formatted(Date.FormatStyle(locale: locale, timeZone: zone).weekday(.abbreviated)) + " " + time
        }
        return date.formatted(Date.FormatStyle(locale: locale, timeZone: zone).day().month(.abbreviated))
    }

    /// `October 2026`, for the Expenses title.
    static func month(_ date: Date = .now, zone: TimeZone = .current, locale: Locale = .current) -> String {
        date.formatted(Date.FormatStyle(locale: locale, timeZone: zone).month(.wide).year())
    }
}

extension CharacterSet {
    /// What may stay unescaped in one query value.
    static let urlQueryValueAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: "&=+#?")
        return set
    }()
}

extension ClinicalFormat {
    /// A bar's axis label: the day of the month for weeks, the month for months (one letter when 24 crowd the axis).
    static func barLabel(iso: String, monthly: Bool, narrow: Bool, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return iso }
        if !monthly { return "\(parts[2])" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        let symbols = narrow ? calendar.veryShortMonthSymbols : calendar.shortMonthSymbols
        return symbols.indices.contains(parts[1] - 1) ? symbols[parts[1] - 1] : iso
    }

    /// Short weekday names Monday first, for the heat map rows.
    static func weekdayRows(locale: Locale = .current) -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = locale
        let sunday = calendar.shortStandaloneWeekdaySymbols
        return Array(sunday[1...]) + [sunday[0]]
    }

    /// An expense category key as people read it (the server's key or the app's enum name).
    static func categoryKey(_ key: String) -> String {
        switch key.lowercased() {
        case "salary", "salaries": "c.cat.salary"
        case "material", "materials": "c.cat.material"
        case "electricity", "utilities": "c.cat.electricity"
        case "lab": "c.cat.lab"
        case "rent": "c.cat.rent"
        default: "c.cat.other"
        }
    }

    /// A bar's width as a share of the biggest, for the breakdown rows.
    static func shares(_ values: [Int64]) -> [Double] {
        let peak = Double(max(values.max() ?? 1, 1))
        return values.map { Double($0) / peak }
    }
}
