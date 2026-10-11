import AarogyamShared
import Foundation

/// Copy from `PatientV7.xcstrings`, the patient pages' own string table.
func pv(_ key: String.LocalizationValue) -> String { String(localized: key, table: "PatientV7") }

/// A formatted string from `PatientV7.xcstrings`.
func pvf(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: pv(key), arguments: args) }

/// The Patients list filter chips of the mockup. Only Recalls can be answered from what the list returns.
enum PatientFilter: CaseIterable {
    case all, dues, recalls, fresh

    /// "With dues" and "New" need the list to carry the balance and the registration date (BK-21).
    var needsServer: Bool { self == .dues || self == .fresh }

    func apply(_ rows: [PatientRow]) -> [PatientRow] {
        self == .recalls ? rows.filter(\.recallDue) : rows
    }

    var title: String {
        switch self {
        case .all: pv("pv.filter.all")
        case .dues: pv("pv.filter.dues")
        case .recalls: pv("pv.filter.recalls")
        case .fresh: pv("pv.filter.new")
        }
    }
}

/// Links that leave the app: the dialler and WhatsApp. They carry a number, never a name.
enum PatientLinks {
    /// The number as `tel:` wants it: digits, with a leading `+` kept.
    static func tel(_ phone: String?) -> URL? {
        guard let phone, !digits(phone).isEmpty else { return nil }
        return URL(string: "tel:" + (phone.trimmingCharacters(in: .whitespaces).hasPrefix("+") ? "+" : "") + digits(phone))
    }

    /// `https://wa.me/<number>`, with a ten-digit Indian number given its country code; `message` is the prefilled text.
    static func whatsApp(_ phone: String?, message: String? = nil) -> URL? {
        guard let phone else { return nil }
        var number = digits(phone)
        if number.count == 10 { number = "91" + number }
        guard number.count >= 11 else { return nil }
        var link = "https://wa.me/" + number
        if let message, !message.isEmpty {
            var allowed = CharacterSet.urlQueryAllowed
            allowed.remove(charactersIn: "&+=#")
            link += "?text=" + (message.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
        }
        return URL(string: link)
    }

    private static func digits(_ phone: String) -> String { phone.filter(\.isASCII).filter(\.isNumber) }
}

/// How a tooth shows on the jaw: the mockup's treated, in progress, planned and watch colours, plus care and missing.
enum JawTone: CaseIterable {
    case plain, treated, progress, watch, care, missing

    static func of(_ finding: Finding) -> JawTone {
        switch finding {
        case .sound: .plain
        case .filled, .crown, .implant, .bridge: .treated
        case .rootCanal: .progress
        case .watch: .watch
        case .caries, .fractured: .care
        case .missing: .missing
        }
    }

    var title: String {
        switch self {
        case .plain: pv("pv.jaw.plain")
        case .treated: pv("pv.jaw.treated")
        case .progress: pv("pv.jaw.progress")
        case .watch: pv("pv.jaw.watch")
        case .care: pv("pv.jaw.care")
        case .missing: pv("pv.jaw.missing")
        }
    }
}

/// Why Save is not possible yet, in words.
extension TreatmentBlock {
    var message: String {
        switch self {
        case .noTreatment: pv("pv.block.no_treatment")
        case .needsVisit: pv("pv.block.needs_visit")
        case .noChartMark: pv("pv.block.no_chart_mark")
        case .surfaceChangePreview: pv("pv.block.surface_change")
        }
    }
}

extension TreatmentStatus {
    var title: String {
        switch self {
        case .completed: pv("pv.status.completed")
        case .planned: pv("pv.status.planned")
        case .watch: pv("pv.status.watch")
        }
    }
}

/// Lab dates and messages.
enum LabFormat {
    /// Whether a due date (`2026-10-09`) is before `today` (same format).
    static func isOverdue(dueOn: String?, today: String) -> Bool {
        guard let dueOn else { return false }
        return dueOn < today
    }

    /// Today's date in the clinic's time zone as `YYYY-MM-DD`.
    static func today(zone: String, now: Date = Date()) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// The WhatsApp text to a lab: the case number and the work, never the patient's name.
    static func whatsAppText(number: String, work: [String]) -> String {
        work.isEmpty ? pvf("pv.lab.wa.plain", number) : pvf("pv.lab.wa.work", number, work.joined(separator: ", "))
    }
}

extension ClinicFormat {
    /// `12 Oct 2026`, from an ISO 8601 instant, in the clinic's time zone; nil when it does not parse.
    static func dateTime(iso8601 text: String, zone: String, locale: Locale = .current) -> String? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = plain.date(from: text) ?? fractional.date(from: text) else { return nil }
        let tz = TimeZone(identifier: zone) ?? .current
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale, timeZone: tz))
    }
}

/// A tooth's place, as the mockup names it: `Lower right · Molar`.
enum ToothName {
    /// The quadrant by FDI number: 1 and 5 upper right, 2 and 6 upper left, 3 and 7 lower left, 4 and 8 lower right.
    static func quadrant(_ number: Int) -> String {
        switch number / 10 {
        case 1, 5: pv("pv.tooth.upper_right")
        case 2, 6: pv("pv.tooth.upper_left")
        case 3, 7: pv("pv.tooth.lower_left")
        default: pv("pv.tooth.lower_right")
        }
    }

    static func text(number: Int, kind: String) -> String { quadrant(number) + " · " + kind }
}

extension LabStatus {
    /// The pill a case shows: READY once back, AT LAB while out, REWORK, and OVERDUE when out past its date.
    func pill(overdue: Bool) -> (text: String, kind: V7Pill.Kind) {
        if overdue && open { return (pv("pv.lab.overdue"), .error) }
        switch self {
        case .received, .fitted: return (pv("pv.lab.ready"), .done)
        case .sent, .inProgress: return (pv("pv.lab.at_lab"), .neutral)
        case .rework: return (pv("pv.lab.rework"), .error)
        case .draft: return (pv("pv.lab.draft"), .neutral)
        case .cancelled: return (pv("pv.lab.cancelled"), .neutral)
        }
    }
}

extension ContactOutcome {
    var title: String {
        switch self {
        case .reached: pv("pv.lab.outcome.reached")
        case .noAnswer: pv("pv.lab.outcome.no_answer")
        case .promisedDate: pv("pv.lab.outcome.promised")
        case .other: pv("pv.lab.outcome.other")
        }
    }
}

extension ContactChannel {
    var title: String {
        switch self {
        case .call: pv("pv.lab.channel.call")
        case .whatsApp: pv("pv.lab.channel.whatsapp")
        case .email: pv("pv.lab.channel.email")
        case .visit: pv("pv.lab.channel.visit")
        }
    }
}

extension LabCase {
    /// `LAB-12 · Crown, Bridge`
    var titleText: String { ([number] + (work.isEmpty ? [] : [work.joined(separator: ", ")])).joined(separator: " · ") }

    /// `Precision Dental · teeth 46, 47 · due 18 Oct`, leaving out what is missing.
    var detailText: String {
        let teethText = teeth.isEmpty ? nil : pvf("pv.lab.teeth", teeth.map { String($0.intValue) }.joined(separator: ", "))
        let due = dueOn.map { pvf("pv.lab.due", ClinicFormat.date(iso: $0)) }
        return [labName, teethText, due].compactMap { $0 }.joined(separator: " · ")
    }
}

extension LabFormat {
    /// A date as `YYYY-MM-DD` in the clinic's time zone.
    static func iso(_ date: Date, zone: String) -> String { today(zone: zone, now: date) }
}

extension LabFormat {
    /// Tooth numbers typed as `46, 47 11`: valid FDI numbers once each, in the order typed.
    static func parseTeeth(_ text: String) -> [Int] {
        var seen = Set<Int>()
        return text.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
            .filter { n in Dentition.allCases.contains { $0.teeth.contains { $0.intValue == n } } }
            .filter { seen.insert($0).inserted }
    }
}
