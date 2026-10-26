import AarogyamShared
import Observation
import SwiftUI

/// What the desk home reads live: the availability strip, each waiting token's issue time, the last doctor
/// of each patient, and which `collect_payment` notification belongs to which token.
///
/// It folds one `/today`, one `/queue` and one `/notifications` per refresh through the shared pure rules
/// (`availabilityOf`). The shared `AvailabilityHolder` and `WaitTimerHolder` need a Kotlin coroutine scope
/// that Swift cannot build (`ScreenScope.scope` is internal and there is no iosMain wrapper for them yet), so
/// until one exists this feed makes the same calls. The seconds are drawn from `issued_at` and the clock in
/// the view, so nothing here ticks. See docs/plans/v10/t7.md.
@MainActor
@Observable
final class DeskV10Feed {
    enum Strip {
        case loading
        /// The role lacks `appointments.read`; nothing was requested.
        case hidden
        case unavailable
        case loaded(AvailabilityStrip)
    }

    struct Waiting: Equatable {
        let tokenId: String
        let doctor: String?
        let issuedAt: Date
    }

    @ObservationIgnored private let clinic: ClinicContext
    private(set) var strip: Strip
    private(set) var doctors: [DeskV10Doctor] = []
    private(set) var waiting: [String: Waiting] = [:]
    /// Patient id to the doctor of their latest token today.
    private(set) var lastDoctor: [String: DeskV10Doctor] = [:]
    /// Token id to the `collect_payment` notification that asked the desk to collect.
    private(set) var payNotification: [String: String] = [:]
    /// Token id to the finish time, for "Doctor may be collecting".
    private(set) var endedAt: [String: Date] = [:]
    private(set) var caps = DeskV10Caps()
    /// Counts every completed refresh, so a sheet can re-check its notification on each one.
    private(set) var version = 0
    @ObservationIgnored private var loading = false

    init(clinic: ClinicContext) {
        self.clinic = clinic
        strip = clinic.permissions.contains("appointments.read") ? .loading : .hidden
        readCaps()
    }

    /// Refreshes now and every 20 seconds while the view is on screen.
    func run() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(for: .seconds(20))
        }
    }

    func readCaps() {
        let flags = ServerCaps.shared
        caps = DeskV10Caps(family: flags.family, paymentProof: flags.paymentProof, queueRemind: flags.queueRemind)
    }

    func refresh() async {
        readCaps()
        guard clinic.permissions.contains("appointments.read"), !loading else { return }
        loading = true
        defer { loading = false }
        async let todayResult = try? clinic.api.today()
        async let queueResult = try? clinic.api.queue(practitionerId: nil)
        let (today, queue) = await (todayResult, queueResult)
        guard let today, let queue, case .success(let todayOk) = onEnum(of: today),
              case .success(let queueOk) = onEnum(of: queue),
              let day = todayOk.value as? TodayResponse, let items = (queueOk.value as? QueueDay)?.items
        else {
            if case .loading = strip { strip = .unavailable }
            return
        }
        let tokens = items
        let minute = Self.minuteOfDay(rfc3339: day.asOf, zoneId: clinic.session.clinic.timezone)
        let built = AvailabilityModelKt.availabilityOf(today: day, tokens: tokens, nowMinute: Int32(minute))
        strip = .loaded(built)
        doctors = built.doctors.map { DeskV10Doctor(id: $0.id, name: $0.name, free: $0.availability == .free) }
        var last: [String: (Date, DeskV10Doctor)] = [:]
        var waits: [String: Waiting] = [:]
        var ended: [String: Date] = [:]
        for token in tokens {
            let issued = Self.date(token.issuedAt)
            if let practitioner = token.practitioner, let issued {
                let pick = DeskV10Doctor(id: practitioner.id, name: practitioner.displayName, free: false)
                if last[token.patient.id].map({ $0.0 < issued }) ?? true { last[token.patient.id] = (issued, pick) }
            }
            if token.status == "waiting", token.calledAt == nil || token.calledAt?.isEmpty == true, let issued {
                waits[token.id] = Waiting(tokenId: token.id, doctor: token.practitioner?.displayName, issuedAt: issued)
            }
            if token.status == "ready_to_bill", let done = token.doneAt.flatMap(Self.date) { ended[token.id] = done }
        }
        waiting = waits
        endedAt = ended
        lastDoctor = last.mapValues { $0.1 }
        await refreshNotifications()
        version += 1
    }

    private func refreshNotifications() async {
        guard let answer = try? await clinic.api.notifications(), case .success(let ok) = onEnum(of: answer),
              let list = ok.value as? NotificationList else { return }
        var map: [String: String] = [:]
        for row in list.items where row.kind == "collect_payment" {
            if let token = row.queueToken { map[token.id] = row.id }
        }
        payNotification = map
    }

    /// Checks `patientId` in with `doctorId` (or the server's default when nil); the token number, or nil on failure.
    func checkIn(patientId: String, doctorId: String?) async -> Int? {
        let request = WalkInRequest(
            allergies: nil, branchId: nil, conditions: nil,
            consents: [DeskConsentFields(method: "verbal", purpose: "care")], familyOf: nil,
            noKnownAllergies: nil, noticeId: nil, noticeVersion: nil,
            patient: nil, patientId: patientId, practitionerId: doctorId, reason: nil
        )
        guard let answer = try? await clinic.api.registerWalkIn(request: request, familyOf: nil),
              case .success(let ok) = onEnum(of: answer), let done = ok.value as? WalkIn else { return nil }
        await refresh()
        return Int(done.token.tokenNumber)
    }

    // MARK: dates

    nonisolated static func date(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text) ?? plain.date(from: text)
    }

    /// The clinic-local minute of the day of an RFC 3339 time (0 when unreadable).
    nonisolated static func minuteOfDay(rfc3339: String, zoneId: String) -> Int {
        guard let date = date(rfc3339) else { return 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zoneId) ?? .gmt
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
}
