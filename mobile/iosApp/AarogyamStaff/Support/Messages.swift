import AarogyamShared
import Foundation
import SakalyaUI

// Copy for the shared code's states and enums. Every string lives in Localizable.xcstrings.

extension ScreenError {
    var message: String {
        switch self {
        case .offline: String(localized: "error.offline")
        case .network: String(localized: "error.network")
        case .signedOut: String(localized: "error.signed_out")
        case .notAllowed: String(localized: "error.not_allowed")
        case .notFound: String(localized: "error.not_found")
        case .upgradeRequired: String(localized: "error.upgrade")
        case .server: String(localized: "error.server")
        case .notConfigured: String(localized: "error.not_configured")
        case .unknown: String(localized: "error.unknown")
        }
    }
}

extension SignInError {
    var message: String {
        switch self {
        case .invalidEmail: String(localized: "sign_in.error.invalid_email")
        case .invalidCode: String(localized: "sign_in.error.invalid_code")
        case .emailNotAccepted: String(localized: "sign_in.error.email_not_accepted")
        case .codeRejected: String(localized: "sign_in.error.code_rejected")
        case .tooManyAttempts: String(localized: "sign_in.error.too_many")
        case .offline: String(localized: "error.offline")
        case .network: String(localized: "error.network")
        case .unknown: String(localized: "error.unknown")
        }
    }
}

extension VisitStatus {
    var label: String {
        switch self {
        case .booked: String(localized: "status.booked")
        case .confirmed: String(localized: "status.confirmed")
        case .arrived: String(localized: "status.waiting")
        case .inChair: String(localized: "status.in_chair")
        case .completed: String(localized: "status.done")
        case .cancelled: String(localized: "status.cancelled")
        case .noShow: String(localized: "status.no_show")
        case .unknown: String(localized: "status.unknown")
        }
    }

    var tone: SkTone {
        switch self {
        case .completed: .success
        case .arrived: .warning
        case .inChair: .brand
        case .confirmed: .info
        case .noShow, .cancelled: .danger
        case .booked, .unknown: .neutral
        }
    }
}

/// Formats clinic-local dates and times. The shared code has already converted them to the
/// clinic's time zone, so they are formatted as wall-clock values (in UTC), never shifted again.
enum ClinicFormat {
    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }

    /// `9:05 AM`, in the phone's locale format.
    static func time(minuteOfDay: Int32, locale: Locale = .current) -> String {
        let date = utc.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: Int(minuteOfDay) / 60, minute: Int(minuteOfDay) % 60)) ?? .distantPast
        return date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, timeZone: utc.timeZone))
    }

    /// `5 Oct 2026`, from an ISO date.
    static func date(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        var style = Date.FormatStyle(locale: locale, timeZone: utc.timeZone).day().month(.abbreviated).year()
        style.calendar = utc
        return date.formatted(style)
    }

    /// `₹1,250`, from paise, with Indian digit grouping.
    static func rupees(paise: Int64, locale: Locale = Locale(identifier: "en_IN")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = "INR"
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter.string(from: (Decimal(paise) / 100) as NSDecimalNumber) ?? "\(paise / 100)"
    }

    /// `Sat 3 Oct`, from an ISO date.
    static func day(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        var style = Date.FormatStyle(locale: locale, timeZone: utc.timeZone).weekday(.abbreviated).day().month(.abbreviated)
        style.calendar = utc
        return date.formatted(style)
    }
}

extension ScheduleItem {
    var startsText: String { ClinicFormat.time(minuteOfDay: starts.minuteOfDay) }
}

extension Sex {
    var label: String? {
        switch self {
        case .female: String(localized: "sex.female")
        case .male: String(localized: "sex.male")
        case .other: String(localized: "sex.other")
        case .unknown: nil
        }
    }
}

extension Severity {
    var label: String {
        switch self {
        case .mild: String(localized: "severity.mild")
        case .moderate: String(localized: "severity.moderate")
        case .severe: String(localized: "severity.severe")
        case .unknown: String(localized: "severity.unknown")
        }
    }

    var tone: SkTone {
        switch self {
        case .severe: .danger
        case .moderate: .warning
        case .mild, .unknown: .neutral
        }
    }
}

/// `SD-1042 · 34 yrs · Female`, from a number, an optional age and an optional sex.
func patientLine(number: String, ageYears: Int?, sex: Sex) -> String {
    let age = ageYears.map { String(format: String(localized: "patients.age"), $0) }
    return [number, age, sex.label].compactMap { $0 }.joined(separator: " · ")
}

extension PatientRow {
    var subtitleText: String { patientLine(number: number, ageYears: ageYears?.intValue, sex: sex) }
}

extension PatientView {
    var headerText: String { patientLine(number: number, ageYears: ageYears?.intValue, sex: sex) }
}

extension ClinicMoment {
    /// `5 Oct 2026 · 10:00 AM`, as the clinic's wall clock.
    var text: String { "\(ClinicFormat.date(iso: date.isoText)) · \(ClinicFormat.time(minuteOfDay: time.minuteOfDay))" }
}

extension VisitView {
    var subtitleText: String { [reason, clinician, number].compactMap { $0 }.joined(separator: " · ") }
}

extension CalendarEntry {
    var subtitleText: String { [ClinicFormat.time(minuteOfDay: starts.minuteOfDay), reason, room].compactMap { $0 }.joined(separator: " · ") }

    var rangeText: String {
        String(
            format: String(localized: "appointment.range"),
            ClinicFormat.time(minuteOfDay: starts.minuteOfDay),
            ClinicFormat.time(minuteOfDay: ends.minuteOfDay)
        )
    }
}
