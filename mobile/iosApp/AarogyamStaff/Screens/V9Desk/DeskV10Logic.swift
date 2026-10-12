import Foundation

func dx(_ key: String.LocalizationValue) -> String { String(localized: key, table: "DeskV10") }
func dxf(_ key: String.LocalizationValue, _ args: CVarArg...) -> String { String(format: dx(key), arguments: args) }

/// The server features the desk screens depend on, as plain values so the rules can be tested.
/// `current` reads the shared `ServerCaps` flags (they never turn off within a session).
struct DeskV10Caps: Equatable {
    var family = false
    var paymentProof = false
    var queueRemind = false

    /// Family controls (the relatives button, the walk-in family picker) show only when the server has family.
    var showsFamily: Bool { family }
    /// The proof photo section of the payment sheet shows only when the server takes a proof.
    var showsProof: Bool { paymentProof }
    /// Remind shows only when the server has the remind call.
    var showsRemind: Bool { queueRemind }
}

/// "Waiting for Dr X · 0:42" and the amber "Check with Dr X" (R11). The numbers come from `issued_at`
/// and the clock passed in, never from a timer's own count.
enum DeskV10Wait {
    /// A waiting token with no reply turns amber at this many seconds.
    static let noReplyAfter = 60

    /// `0:42`; minutes are not capped (`75:03`).
    static func clock(seconds: Int) -> String {
        let s = max(0, seconds)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    static func isNoReply(seconds: Int) -> Bool { seconds >= noReplyAfter }

    static func elapsed(since issued: Date, now: Date) -> Int { max(0, Int(now.timeIntervalSince(issued))) }

    static func waitingLine(doctor: String?, seconds: Int) -> String {
        guard let doctor, !doctor.isEmpty else { return dxf("dx.wait.line.nodoc", clock(seconds: seconds)) }
        return dxf("dx.wait.line", DeskV10Doctors.label(doctor), clock(seconds: seconds))
    }

    static func checkLine(doctor: String?) -> String {
        guard let doctor, !doctor.isEmpty else { return dx("dx.wait.check.nodoc") }
        return dxf("dx.wait.check", DeskV10Doctors.label(doctor))
    }
}

/// A doctor the desk can check a patient in with.
struct DeskV10Doctor: Equatable, Hashable, Identifiable {
    let id: String
    let name: String
    let free: Bool
}

enum DeskV10Doctors {
    /// `Dr Patil`; a name that already starts with Dr or Dr. is left as it is.
    static func label(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let lower = trimmed.lowercased()
        if lower == "dr" || lower.hasPrefix("dr.") || lower.hasPrefix("dr ") { return trimmed }
        return dxf("dx.dr", trimmed)
    }

    /// The chip text on a picked profile: `Check in · Dr Patil`, or just `Check in` with no doctor.
    static func checkInTitle(_ doctor: DeskV10Doctor?) -> String {
        guard let doctor else { return dx("dx.home.checkin.nodoc") }
        return dxf("dx.home.checkin", label(doctor.name))
    }

    /// Who a patient is checked in with: the doctor the desk chose, else the last doctor when they are
    /// free, else any free doctor, else the last doctor (they will wait), else nobody.
    static func pick(doctors: [DeskV10Doctor], lastDoctorId: String?, chosenId: String?) -> DeskV10Doctor? {
        if let chosenId, let chosen = doctors.first(where: { $0.id == chosenId }) { return chosen }
        let last = doctors.first { $0.id == lastDoctorId }
        if let last, last.free { return last }
        if let free = doctors.first(where: \.free) { return free }
        return last
    }
}

/// The desk's "token is called" banner: token numbers only, never a name (R12).
enum DeskV10Banner {
    static func calledText(tokens: [Int]) -> String {
        let sorted = tokens.sorted()
        if sorted.count == 1 { return dxf("dx.called.one", sorted[0]) }
        return dxf("dx.called.many", sorted.map(String.init).joined(separator: ", "))
    }
}

enum DeskV10Collect {
    /// A `ready_to_bill` token finished less than two minutes ago: the doctor may still be collecting.
    /// Display only; the payment is never blocked.
    static func mayBeCollecting(status: String, endedAt: Date?, now: Date) -> Bool {
        guard status == "ready_to_bill", let endedAt else { return false }
        let age = now.timeIntervalSince(endedAt)
        return age >= 0 && age < 120
    }
}

/// The availability strip's chips, in order, from the counts; empty groups are kept so a zero reads as zero.
struct DeskV10StripChip: Equatable {
    enum Tone { case success, info, neutral, warning }
    let text: String
    let tone: Tone
}

enum DeskV10Strip {
    static func chips(doctorsFree: Int, withPatient: Int, away: Int, hasDoctors: Bool,
                      chairsFree: Int, chairsBusy: Int, hasChairs: Bool) -> [DeskV10StripChip] {
        var chips: [DeskV10StripChip] = []
        if hasDoctors {
            chips.append(DeskV10StripChip(text: dxf("dx.strip.doctors_free", doctorsFree), tone: .success))
            chips.append(DeskV10StripChip(text: dxf("dx.strip.with_patient", withPatient), tone: .info))
            chips.append(DeskV10StripChip(text: dxf("dx.strip.away", away), tone: .neutral))
        }
        if hasChairs {
            chips.append(DeskV10StripChip(text: dxf("dx.strip.chairs_free", chairsFree), tone: .success))
            chips.append(DeskV10StripChip(text: dxf("dx.strip.chairs_busy", chairsBusy), tone: .warning))
        }
        return chips
    }
}
