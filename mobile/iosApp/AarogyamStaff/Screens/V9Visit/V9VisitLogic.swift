import AarogyamShared
import Foundation

/// Copy from `VisitV9.xcstrings` (en, hi, mr), the string table of the one-screen visit.
func V9(_ key: String.LocalizationValue) -> String { String(localized: key, table: "VisitV9") }

/// A formatted line from `VisitV9.xcstrings`: the catalogue entry is a `String(format:)` pattern.
func V9f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String {
    String(format: String(localized: key, table: "VisitV9"), arguments: args)
}

/// The tag on a note bullet: S, O or P, the SOAP section the bullet lands in.
enum NoteTag {
    /// The next kind when the tag is tapped: Complaint, Finding, Advice, and round again. A
    /// dictated bullet reads as a complaint, so its next kind is Finding.
    static func next(_ kind: BulletKind) -> BulletKind {
        switch kind {
        case .complaint, .dictated: .finding
        case .finding: .advice
        case .advice: .complaint
        }
    }

    /// The one-letter section of the bullet.
    static func letter(_ kind: BulletKind) -> String {
        switch kind {
        case .complaint, .dictated: "S"
        case .finding: "O"
        case .advice: "P"
        }
    }

    /// The kind a newly written bullet gets: the one before it (a person writing findings keeps
    /// writing findings), Complaint at the start.
    static func kindForNew(after bullets: [Bullet]) -> BulletKind {
        guard let last = bullets.last else { return .complaint }
        return last.kind == .dictated ? .complaint : last.kind
    }
}

/// Dose cells, days and the total of one medicine line, over the shared `RxDose`.
enum V9Dose {
    static let slots: [DoseSlot] = [.morning, .afternoon, .night]

    /// The dose a frequency text stands for; nil for `SOS` and anything else that is not three steps.
    static func parse(_ frequency: String) -> RxDose? { RxDose.companion.parse(text: frequency) }

    /// The count shown in a cell: `0`, `½`, `1` or `2`.
    static func cell(_ halves: Int32) -> String {
        switch halves {
        case 0: "0"
        case 1: "½"
        case 2: "1"
        case 4: "2"
        default: String(Double(halves) / 2)
        }
    }

    /// The halves in `slot` of `frequency`; an unreadable frequency counts as nothing.
    static func halves(_ frequency: String, slot: DoseSlot) -> Int32 {
        (parse(frequency) ?? RxDose(morning: 0, afternoon: 0, night: 0)).halves(slot: slot)
    }

    /// The frequency after a tap on `slot`: 0, then ½, 1, 2 and back to 0. An unreadable frequency starts from 0-0-0.
    static func cycled(_ frequency: String, slot: DoseSlot) -> String {
        (parse(frequency) ?? RxDose(morning: 0, afternoon: 0, night: 0)).cycle(slot: slot).format()
    }

    /// The pieces to dispense for the course, or nil when the form is not counted or the dose is unreadable.
    static func total(frequency: String, days: Int, form: String?) -> Int? {
        guard let dose = parse(frequency) else { return nil }
        return RxDoseKt.unitsTotal(dose: dose, days: Int32(days), form: form)?.intValue
    }

    /// The form of a medicine from the line's detail (`500 mg tablet`): its last word.
    static func form(fromDetail detail: String) -> String? {
        detail.split(separator: " ").last.map { String($0).lowercased() }
    }

    /// `1-0-1 · 10 tablets`; just the frequency when no count can be given, and `up to` for SOS.
    static func totalText(frequency: String, days: Int, detail: String, sos: Bool = false) -> String {
        let kind = form(fromDetail: detail)
        guard let count = total(frequency: frequency, days: days, form: kind) else { return frequency }
        let unit = (kind ?? "").hasPrefix("cap")
            ? (count == 1 ? V9("v9v.rx.unit.capsule") : V9("v9v.rx.unit.capsules"))
            : (count == 1 ? V9("v9v.rx.unit.tablet") : V9("v9v.rx.unit.tablets"))
        let amount = V9f("v9v.rx.total", count, unit)
        return "\(frequency) · \(sos ? V9f("v9v.rx.up_to", amount) : amount)"
    }

    /// The days a stepper tap leads to, kept inside the composer's range of 1 to 90.
    static func days(_ current: Int, step: Int) -> Int {
        min(max(current + step, Int(RxDoseKt.RX_MIN_DAYS)), Int(RxDoseKt.RX_MAX_DAYS))
    }
}

/// What tapping Close visit does.
enum CloseDecision: Equatable {
    /// Nothing is pending: close now.
    case close
    /// A prescription was written and not signed: ask first ("Close anyway" or "Sign now").
    case confirmUnsigned
}

enum CloseGuard {
    /// Closing asks first when there are medicines on the prescription and it has not been signed.
    /// A prescription with no medicines is not a prescription, so nothing is lost by closing.
    static func decide(medicines: Int, signed: Bool) -> CloseDecision {
        medicines > 0 && !signed ? .confirmUnsigned : .close
    }
}

/// The optional fee and follow-up entered at close.
enum V9Close {
    /// Rupees typed as `1,500` or `₹ 1500` in paise; nil when empty or not a whole number of rupees.
    static func paise(fromRupees text: String) -> Int64? {
        let digits = text.filter { $0.isNumber }
        guard !digits.isEmpty, digits.count <= 9, let rupees = Int64(digits) else { return nil }
        return rupees * 100
    }

    /// `₹1,500`, whole rupees in the Indian grouping.
    static func rupees(paise: Int64, locale: Locale = Locale(identifier: "en_IN")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = "INR"
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: paise / 100)) ?? "₹\(paise / 100)"
    }
}

/// A treatment picked on the screen and held until the visit closes: done procedures never
/// change on the server, so a line can only be taken off while it is still local.
struct StagedProcedure: Identifiable, Equatable {
    let id = UUID()
    let tooth: Int
    let term: TermView

    static func == (lhs: StagedProcedure, rhs: StagedProcedure) -> Bool { lhs.id == rhs.id }
}
