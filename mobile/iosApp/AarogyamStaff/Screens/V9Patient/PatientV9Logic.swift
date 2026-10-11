import AarogyamShared
import Foundation

/// Copy for the v9 patient page (PatientV9.xcstrings: en, hi, mr).
func p9(_ key: String.LocalizationValue) -> String { String(localized: key, table: "PatientV9") }

func p9f(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: p9(key), arguments: args) }

/// The three pill tabs of the patient page.
enum PatientPageTab: CaseIterable, Hashable {
    case overview, history, consent

    /// The tabs a role sees: Overview needs `clinical.read`; History and Consent need `patients.read`.
    static func visible(permissions: Set<String>) -> [PatientPageTab] {
        allCases.filter { tab in
            switch tab {
            case .overview: permissions.contains("clinical.read")
            case .history, .consent: permissions.contains("patients.read")
            }
        }
    }

    /// `History · 4` once the count is known.
    func title(historyCount: Int?) -> String {
        switch self {
        case .overview: p9("p9.tab.overview")
        case .history: historyCount.map { p9f("p9.tab.history_n", $0) } ?? p9("p9.tab.history")
        case .consent: p9("p9.tab.consent")
        }
    }
}

/// What the header's money strip shows: nothing without money, a closed bar, or the three cells.
enum MoneyStripModel: Equatable {
    case none
    case closed
    case open(visits: String, paid: String, due: String, hasDue: Bool)

    /// `money` is null for a role without `billing.read`; `shown` starts false.
    static func make(money: MoneySummary?, shown: Bool) -> MoneyStripModel {
        guard let money else { return .none }
        guard shown else { return .closed }
        return .open(
            visits: String(money.visits),
            paid: ClinicFormat.rupees(paise: money.paidPaise),
            due: ClinicFormat.rupees(paise: money.remainingPaise),
            hasDue: money.remainingPaise > 0
        )
    }
}

/// One History card's pieces, formatted.
enum HistoryRowFormat {
    struct Badge: Equatable {
        let top: String
        let bottom: String?
        var isToday: Bool { bottom == nil }
    }

    enum Chip: Equatable {
        case notes, rx, photos, paid, due, open

        var title: String {
            switch self {
            case .notes: p9("p9.chip.notes")
            case .rx: p9("p9.chip.rx")
            case .photos: p9("p9.chip.photos")
            case .paid: p9("p9.chip.paid")
            case .due: p9("p9.chip.due")
            case .open: p9("p9.chip.open")
            }
        }
    }

    /// The date badge: day and month, or "Today" for the clinic's today.
    static func badge(dateISO: String, todayISO: String, locale: Locale = .current) -> Badge {
        if dateISO == todayISO { return Badge(top: p9("p9.today"), bottom: nil) }
        let parts = dateISO.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return Badge(top: dateISO, bottom: "") }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let month = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
            .map { $0.formatted(Date.FormatStyle(locale: locale, timeZone: .gmt).month(.abbreviated)) } ?? ""
        return Badge(top: String(parts[2]), bottom: month)
    }

    /// The chips of a card: what the list knows. Notes and photos only when the list says so;
    /// the bill chip only for a role that sees money.
    static func chips(hasNotes: Bool?, hasRx: Bool, hasPhotos: Bool?, bill: BillState, open: Bool) -> [Chip] {
        var out: [Chip] = []
        if open { out.append(.open) }
        if hasNotes == true { out.append(.notes) }
        if hasRx { out.append(.rx) }
        if hasPhotos == true { out.append(.photos) }
        switch bill {
        case .paid: out.append(.paid)
        case .due: out.append(.due)
        default: break
        }
        return out
    }
}

/// A medicine's morning, afternoon and night cells with the days and the total, from the shared dosing model.
struct DoseDisplay: Equatable {
    struct Cell: Equatable { let label: String; let value: String; let on: Bool }

    let cells: [Cell]
    let frequency: String
    let timing: String?
    let days: String?
    let total: String?

    static func make(frequency: String?, timing: String?, days: Int?, form: String?) -> DoseDisplay {
        let dose = frequency.flatMap { RxDose.companion.parse(text: $0) }
        let labels = [p9("p9.dose.morning"), p9("p9.dose.afternoon"), p9("p9.dose.night")]
        let slots: [DoseSlot] = [.morning, .afternoon, .night]
        let cells = zip(labels, slots).map { label, slot -> Cell in
            guard let dose else { return Cell(label: label, value: "–", on: false) }
            let halves = Int(dose.halves(slot: slot))
            return Cell(label: label, value: halvesText(halves), on: halves > 0)
        }
        let timingText = RxTiming.companion.fromApi(text: timing).map { timingLabel($0) } ?? timing
        let isSos = RxTiming.companion.fromApi(text: timing) == .sos
        var total: String?
        if let dose, let days, let n = RxDoseKt.unitsTotal(dose: dose, days: Int32(days), form: form) {
            total = (isSos ? p9("p9.dose.up_to") + " " : "") + String(n.intValue) + " " + unit(form: form, count: n.intValue)
        }
        return DoseDisplay(
            cells: cells,
            frequency: dose?.format() ?? frequency ?? "",
            timing: timingText,
            days: days.map { p9f("p9.dose.days", $0) },
            total: total
        )
    }

    static func halvesText(_ halves: Int) -> String {
        let whole = halves / 2
        if halves % 2 == 0 { return String(whole) }
        return whole == 0 ? "½" : "\(whole)½"
    }

    private static func unit(form: String?, count: Int) -> String {
        switch form?.lowercased() {
        case "capsule": count == 1 ? p9("p9.unit.capsule") : p9("p9.unit.capsules")
        default: count == 1 ? p9("p9.unit.tablet") : p9("p9.unit.tablets")
        }
    }

    static func timingLabel(_ timing: RxTiming) -> String {
        switch timing {
        case .beforeFood: p9("p9.timing.before_food")
        case .afterFood: p9("p9.timing.after_food")
        case .emptyStomach: p9("p9.timing.empty_stomach")
        case .bedtime: p9("p9.timing.bedtime")
        case .sos: p9("p9.timing.sos")
        case .asDirected: p9("p9.timing.as_directed")
        }
    }
}
