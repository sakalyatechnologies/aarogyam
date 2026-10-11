import AarogyamShared
import Foundation

func dv(_ key: String.LocalizationValue) -> String { String(localized: key, table: "DeskV9") }
func dvf(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: dv(key), arguments: args) }

/// The mobile field: what is typed, what is searched, what is shown.
enum DeskPhone {
    static let length = 10

    /// The national digits of whatever was typed or pasted: spaces, dashes and brackets dropped,
    /// a pasted `+91` or trunk `0` removed, at most ten digits.
    static func digits(_ typed: String) -> String {
        var digits = typed.filter { $0.isASCII && $0.isNumber }
        if digits.count == length + 2, digits.hasPrefix("91") { digits.removeFirst(2) }
        if digits.count == length + 1, digits.hasPrefix("0") { digits.removeFirst() }
        return String(digits.prefix(length))
    }

    /// `98765 43210`: the digits in two groups of five, as the field shows them.
    static func format(_ typed: String) -> String {
        let digits = digits(typed)
        guard digits.count > 5 else { return digits }
        return "\(digits.prefix(5)) \(digits.dropFirst(5))"
    }

    static func isComplete(_ typed: String) -> Bool { digits(typed).count == length }
}

/// The waiting-room board's rules, apart from the views so they can be tested.
enum DeskBoard {
    /// The board's rows, top to bottom.
    static let order: [PatientState] = [.waiting, .called, .inConsult, .inChair, .readyToBill]

    /// Every board state in order (empty ones included), each with its items in the order given.
    static func groups<T>(_ items: [T], state: (T) -> PatientState) -> [(state: PatientState, items: [T])] {
        order.map { wanted in (wanted, items.filter { state($0) == wanted }) }
    }

    /// Roles that send a waiting patient in: the doctor, and the owner who is also one.
    static func canSendIn(roleKey: String) -> Bool { roleKey == "doctor" || roleKey == "owner" }

    /// The "Send in" button shows on Waiting tickets for those roles; it calls `POST /queue/{id}/call`.
    static func showsSendIn(roleKey: String, state: PatientState) -> Bool { canSendIn(roleKey: roleKey) && state == .waiting }

    /// The desk (who is not sending patients in) sees the "Patient called in" banner.
    static func showsCalledBanner(roleKey: String, called: Int) -> Bool { !canSendIn(roleKey: roleKey) && called > 0 }
}

/// The queue notifications the server sends staff (BE4), as the bell draws them.
enum DeskAlert {
    static func isQueue(_ kind: String) -> Bool { ["patient_waiting", "send_in", "collect_payment"].contains(kind) }

    static func title(_ kind: String) -> String? {
        switch kind {
        case "patient_waiting": dv("d9.alert.patient_waiting")
        case "send_in": dv("d9.alert.send_in")
        case "collect_payment": dv("d9.alert.collect_payment")
        default: nil
        }
    }

    static func icon(_ kind: String) -> String {
        switch kind {
        case "patient_waiting": "clock"
        case "send_in": "bell"
        case "collect_payment": "check"
        default: "msg"
        }
    }

    /// `#7 · SC-1042 · Dr. Patil`: the token and the clinic number, never the patient's name.
    static func detail(token: Int?, number: String?, doctor: String?) -> String? {
        guard let token else { return nil }
        return ["#\(token)", number, doctor].compactMap { $0 }.joined(separator: " · ")
    }
}

enum DeskPayProblem: Equatable { case amount, method }

/// The collect-payment form's checks and amounts.
enum DeskPay {
    /// Rupees typed as `1250`, `1,250` or `1250.5`, in paise; nil for anything else, zero included.
    static func paise(from text: String) -> Int64? {
        let clean = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "")
        let parts = clean.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), parts[0].count >= 1, parts[0].count <= 9, parts[0].allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        var cents: Int64 = 0
        if parts.count == 2 {
            guard parts[1].count <= 2, parts[1].allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            cents = Int64(parts[1].padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0
        }
        let total = (Int64(parts[0]) ?? 0) * 100 + cents
        return total > 0 ? total : nil
    }

    /// What blocks Record: an amount that is not above zero, and no method chosen.
    static func problems(amountText: String, method: PayMethod?) -> [DeskPayProblem] {
        var found: [DeskPayProblem] = []
        if paise(from: amountText) == nil { found.append(.amount) }
        if method == nil { found.append(.method) }
        return found
    }

    /// `1250` for 125000 paise, `1250.5` for 125050: the amount field's starting text.
    static func rupeesText(paise: Int64) -> String {
        let whole = paise / 100, cents = paise % 100
        if cents == 0 { return String(whole) }
        return cents % 10 == 0 ? "\(whole).\(cents / 10)" : "\(whole).\(String(format: "%02d", Int(cents)))"
    }
}

extension PatientState {
    var title: String {
        switch self {
        case .waiting: dv("d9.state.waiting")
        case .called: dv("d9.state.called")
        case .inConsult: dv("d9.state.in_consult")
        case .inChair: dv("d9.state.in_chair")
        case .readyToBill: dv("d9.state.ready_to_bill")
        case .done: dv("d9.state.done")
        case .left: dv("d9.state.left")
        }
    }
}

/// Linking an existing patient as a relative: what must be true before "Link patient" is sent.
enum DeskFamilyLink {
    /// The unmet conditions (empty when the link can be sent); the rules live in the shared code.
    static func problems(patientId: String, pickedId: String?, relation: DeskRelation?, linkedIds: Set<String>) -> [LinkProblem] {
        FamilyStateHolderKt.linkProblems(patientId: patientId, pickedId: pickedId, relation: relation?.wire, linkedIds: linkedIds)
    }

    static func message(_ problem: LinkProblem) -> String {
        switch problem {
        case .noPatient: dv("d9.family.link.need_patient")
        case .themselves: dv("d9.family.link.self")
        case .alreadyLinked: dv("d9.family.link.already")
        case .badRelation: dv("d9.family.link.need_relation")
        }
    }
}
