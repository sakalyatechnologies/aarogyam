import Foundation

/// `String(localized:)` from the LiveV10 table.
func lv(_ key: String.LocalizationValue) -> String { String(localized: key, table: "LiveV10") }

/// Pure helpers for the live banner (kept free of views so they can be tested).
enum LiveV10Logic {
    /// The banner line for a notification kind and token number; nil for a kind that gets no banner.
    /// Only the token number is used, never a patient's name.
    static func text(kind: String, token: Int?) -> String? {
        let key: String.LocalizationValue
        switch (kind, token) {
        case ("patient_waiting", .some): key = "lv10.waiting"
        case ("send_in", .some): key = "lv10.sendin"
        case ("collect_payment", .some): key = "lv10.collect"
        case ("patient_waiting", nil): key = "lv10.waiting.nonumber"
        case ("send_in", nil): key = "lv10.sendin.nonumber"
        case ("collect_payment", nil): key = "lv10.collect.nonumber"
        default: return nil
        }
        let format = String(localized: key, table: "LiveV10")
        guard let token else { return format }
        return String(format: format, token)
    }
}
