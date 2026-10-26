import AarogyamShared
import SwiftUI

func dv10(_ key: String.LocalizationValue) -> String { String(localized: key, table: "DoctorV10") }

func dv10f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String {
    String(format: String(localized: key, table: "DoctorV10"), arguments: args)
}

/// Pure text helpers of the doctor journey, kept apart from the views so they can be tested.
enum DoctorV10Format {
    /// The fee as the editable field shows it: whole rupees, no symbol or grouping; empty for none.
    static func feeText(paise: Int64?) -> String {
        guard let paise, paise > 0 else { return "" }
        return String(paise / 100)
    }

    /// The fee typed in rupees back to paise; nil for empty or zero.
    static func feePaise(text: String) -> Int64? {
        guard let paise = V9Close.paise(fromRupees: text), paise > 0 else { return nil }
        return paise
    }

    static func followUpLabel(_ choice: FollowUpChoice) -> String {
        switch choice {
        case .oneWeek: dv10("dv10.fu.oneweek")
        case .twoWeeks: dv10("dv10.fu.twoweeks")
        case .oneMonth: dv10("dv10.fu.onemonth")
        case .sixMonths: dv10("dv10.fu.sixmonths")
        case .notNeeded: dv10("dv10.fu.none")
        }
    }

    /// `2026-11-01` as a short date in the person's language; the text itself when it is not a date.
    static func shortDate(iso: String, locale: Locale = .current) -> String {
        let parser = DateFormatter()
        parser.calendar = Calendar(identifier: .gregorian)
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(iso.prefix(10))) else { return iso }
        let out = DateFormatter()
        out.locale = locale
        out.setLocalizedDateFormatFromTemplate("d MMM")
        return out.string(from: date)
    }

    /// "Visit closed · Rx sent · follow-up 8 Nov · desk asked for ₹1,500". Holds no patient name.
    static func celebration(rxIssued: Bool, followUpOn: String?, collected: Bool, totalPaise: Int64?, locale: Locale = .current) -> String {
        var parts = [dv10("dv10.done.visit")]
        if rxIssued { parts.append(dv10("dv10.done.rx")) }
        if let followUpOn { parts.append(dv10f("dv10.done.followup", shortDate(iso: followUpOn, locale: locale))) }
        if let total = totalPaise, total > 0 {
            let amount = V9Close.rupees(paise: total)
            parts.append(collected ? dv10f("dv10.done.collect", amount) : dv10f("dv10.done.desk", amount))
        } else if !collected {
            parts.append(dv10("dv10.done.desk.nofee"))
        }
        return parts.joined(separator: " · ")
    }

    /// "42 y · Female"; the parts that are missing are left out.
    static func ageSex(age: Int?, sex: String) -> String {
        var parts: [String] = []
        if let age { parts.append(dv10f("dv10.age", String(age))) }
        switch sex.lowercased() {
        case "male": parts.append(dv10("dv10.sex.male"))
        case "female": parts.append(dv10("dv10.sex.female"))
        case "other": parts.append(dv10("dv10.sex.other"))
        default: break
        }
        return parts.joined(separator: " · ")
    }
}

/// FDI tooth numbers, upper arch then lower, for the chair-mode chips.
enum DoctorV10Teeth {
    static let upper = Array((11...18).reversed()) + Array(21...28)
    static let lower = Array((41...48).reversed()) + Array(31...38)
}
