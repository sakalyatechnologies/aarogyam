import AarogyamShared
import SakalyaUI
import SwiftUI

/// The days the booking sheet offers, from `today` (`YYYY-MM-DD`), as ISO dates.
enum BookingDays {
    static func next(_ count: Int, from today: String) -> [String] {
        let parts = today.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        guard parts.count == 3, let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return [] }
        return (0..<count).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }.map { date in
            let c = calendar.dateComponents([.year, .month, .day], from: date)
            return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }
    }

    /// The shared date for an ISO day.
    static func date(_ iso: String) -> Kotlinx_datetimeLocalDate {
        let p = iso.split(separator: "-").compactMap { Int32($0) }
        return Kotlinx_datetimeLocalDate(year: p[0], month: p[1], day: p[2])
    }
}

/// "Book appointment" for one patient: doctor, day, a free slot and optionally a chair, on the shared `BookingStateHolder`.
struct PatientBookSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let name: String

    var body: some View {
        let today = LabFormat.today(zone: clinic.session.clinic.timezone)
        ScreenHost(make: { graph.booking(clinic: clinic, patientId: patientId, date: BookingDays.date(today), screen: $0) }, state: { $0.state }) { holder, state in
            BookBody(holder: holder, state: state, name: name, today: today)
        }
    }
}

private struct BookBody: View {
    let holder: BookingStateHolder
    let state: BookingState
    let name: String
    let today: String
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if state.booked != nil {
                    done
                } else if !state.allowed {
                    SkEmptyState(pv("pv.book.title"), message: pv("pv.book.not_allowed"))
                } else {
                    SkSheetHeader(pv("pv.book.title"), subtitle: [name, state.doctors.first { $0.id == state.doctorId }?.label].compactMap { $0 }.joined(separator: " · "))
                    if state.doctors.count > 1 {
                        SkChoiceChips(state.doctors, selected: Set(state.doctors.filter { $0.id == state.doctorId }), label: { $0.label }) { holder.chooseDoctor(id: $0.id) }
                    }
                    V7ChipRow {
                        ForEach(BookingDays.next(7, from: today), id: \.self) { day in
                            SkChoiceChip(ClinicFormat.day(iso: day), selected: day == state.date.isoText) { holder.chooseDate(date: BookingDays.date(day)) }
                        }
                    }
                    V7Label(text: pvf("pv.book.free", ClinicFormat.day(iso: state.date.isoText)))
                    slots
                    if !state.chairs.isEmpty {
                        SkChoiceChips(state.chairs, selected: Set(state.chairs.filter { $0.id == state.chairId }), label: { $0.label }) { c in
                            holder.chooseChair(id: c.id == state.chairId ? nil : c.id)
                        }
                    }
                    HStack(spacing: 6) {
                        V7Icon(name: "wa", size: 14, tint: r.onSurfaceVariant.color)
                        Text(pv("pv.book.reminder")).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                    }
                    if let error = state.error { Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                    SkPillButton(state.chosen.map { pvf("pv.book.cta", ClinicFormat.time(minuteOfDay: $0.time.minuteOfDay)) } ?? pv("pv.book.pick"), wide: true, loading: state.saving, action: holder.book)
                        .disabled(!state.canBook)
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .skSheet()
    }

    @ViewBuilder private var slots: some View {
        if state.loadingSlots {
            SkLoadingIndicator(pv("pv.loading"))
        } else if state.slots.isEmpty {
            V7Muted(state.doctorId == nil ? pv("pv.book.pick_doctor") : pv("pv.book.no_slots"))
        } else {
            SkChoiceChips(state.slots, selected: Set(state.slots.filter { $0.starts == state.chosen?.starts }), label: { ClinicFormat.time(minuteOfDay: $0.time.minuteOfDay) }) { holder.chooseSlot(slot: $0) }
        }
    }

    private var done: some View {
        VStack(spacing: 12) {
            SkCheckDraw().frame(width: 72, height: 72)
            Text(pv("pv.book.done")).v7Text(18, .heavy).foregroundStyle(theme.roles.onSurface.color)
            ForEach(state.warnings, id: \.self) { w in V7Pill(text: w.label, kind: .warm) }
            SkPillButton(String(localized: "done"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }
}

extension BookingWarningKind {
    var label: String {
        switch self {
        case .practitionerBusy: pv("pv.book.warn.busy")
        case .practitionerOnLeave: pv("pv.book.warn.leave")
        case .outsideWorkingHours: pv("pv.book.warn.hours")
        case .other: pv("pv.book.warn.other")
        }
    }
}
