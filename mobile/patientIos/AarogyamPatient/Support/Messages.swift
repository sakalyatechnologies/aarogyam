import AarogyamPatientShared
import Foundation
import SakalyaUI

// Copy for the shared code's states and enums. Every string lives in Localizable.xcstrings.

extension ScreenError {
    var message: String {
        switch self {
        case .offline: String(localized: "error.offline")
        case .network, .server: String(localized: "error.network")
        case .signedOut: String(localized: "error.signed_out")
        case .upgradeRequired: String(localized: "error.upgrade")
        case .notConfigured: String(localized: "error.not_configured")
        case .notAllowed, .notFound, .unknown: String(localized: "error.unknown")
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
        case .tooManyAttempts: String(localized: "error.too_many")
        case .offline: String(localized: "error.offline")
        case .network: String(localized: "error.network")
        case .unknown: String(localized: "error.unknown")
        }
    }
}

extension LinkError {
    var message: String {
        switch self {
        case .invalidCode: String(localized: "link.error.invalid_code")
        case .codeNotFound: String(localized: "link.error.not_found")
        case .otherRecord: String(localized: "link.error.other_record")
        case .recordTaken: String(localized: "link.error.taken")
        case .noClinic: String(localized: "link.error.no_clinic")
        case .tooManyAttempts: String(localized: "error.too_many")
        case .offline: String(localized: "error.offline")
        case .failed: String(localized: "error.unknown")
        }
    }
}

extension VisitStatus {
    var label: String {
        switch self {
        case .requested: String(localized: "status.requested")
        case .booked: String(localized: "status.booked")
        case .confirmed: String(localized: "status.confirmed")
        case .atClinic: String(localized: "status.at_clinic")
        case .done: String(localized: "status.done")
        case .cancelled: String(localized: "status.cancelled")
        case .missed, .unknown: String(localized: "status.missed")
        }
    }

    var tone: SkTone {
        switch self {
        case .requested: .warning
        case .confirmed: .success
        case .booked, .atClinic: .brand
        case .done, .cancelled, .missed, .unknown: .neutral
        }
    }
}

extension BookingError {
    var message: String {
        switch self {
        case .bookingOff: String(localized: "book.error.off")
        case .slotTaken: String(localized: "book.error.taken")
        case .offline: String(localized: "error.offline")
        case .failed: String(localized: "error.unknown")
        }
    }
}

/// When a medicine is taken, from the API's value.
enum Timing {
    static func text(_ value: String) -> String {
        switch value {
        case "before_food": String(localized: "timing.before_food")
        case "after_food": String(localized: "timing.after_food")
        case "empty_stomach": String(localized: "timing.empty_stomach")
        case "bedtime": String(localized: "timing.bedtime")
        case "sos": String(localized: "timing.sos")
        default: String(localized: "timing.as_directed")
        }
    }
}

/// Dates, times and money as the clinic shows them: wall-clock values, never converted.
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

    /// `Thu, 8 Oct 2026`, from an ISO date.
    static func date(iso: String, locale: Locale = .current) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, let date = utc.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return iso }
        var style = Date.FormatStyle(locale: locale, timeZone: utc.timeZone).weekday(.abbreviated).day().month(.abbreviated).year()
        style.calendar = utc
        return date.formatted(style)
    }

    /// `₹1,250`, from paise, with Indian digit grouping.
    static func rupees(paise: Int64, locale: Locale = Locale(identifier: "en_IN")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = "INR"
        formatter.minimumFractionDigits = paise % 100 == 0 ? 0 : 2
        formatter.maximumFractionDigits = 2
        return formatter.string(from: (Decimal(paise) / 100) as NSDecimalNumber) ?? "\(paise / 100)"
    }
}

extension ClinicTime {
    var dateText: String { ClinicFormat.date(iso: date.isoText) }
    var timeText: String { ClinicFormat.time(minuteOfDay: time.minuteOfDay) }
    var text: String { "\(dateText) · \(timeText)" }
}

extension AppointmentView {
    /// `with Dr Asha Rao · Sunrise Dental`.
    var whoAndWhere: String {
        String(format: String(localized: "visit.with_at"), doctorName, clinicName)
    }
}
