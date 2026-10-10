import AarogyamShared
import SakalyaUI
import SwiftUI

/// Book an appointment: pick the patient (unless one is given), then the shared BookingStateHolder
/// drives doctor, day, visit kind, chair, free slot and reason.
struct BookFlow: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let dateISO: String
    @State var patientId: String?

    var body: some View {
        Group {
            if let patientId {
                ScreenHost(make: { graph.booking(clinic: clinic, patientId: patientId, date: IosDates.parse(dateISO), screen: $0) }, state: { $0.state }) { holder, state in
                    BookingSheet(holder: holder, state: state, firstDay: dateISO)
                }
            } else {
                ScreenHost(make: { graph.patients(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    PatientPicker(holder: holder, state: state) { patientId = $0 }
                }
            }
        }
        .skSheet()
    }
}

/// Step one: search the clinic's patients.
private struct PatientPicker: View {
    let holder: PatientsStateHolder
    let state: PatientsState
    let onPick: (String) -> Void
    @State private var text = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkSheetScaffold(String(localized: "t7.book.title", table: "TodayV7"), subtitle: String(localized: "t7.book.pick_patient", table: "TodayV7")) {
            SkSearchField(text: $text, prompt: String(localized: "patients.search"))
                .onChange(of: text) { _, new in holder.search(text: new) }
            switch onEnum(of: state) {
            case .notAllowed:
                SkEmptyState(String(localized: "patients.not_allowed.title"), message: String(localized: "patients.not_allowed.message"))
            case .loading:
                SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity)
            case .failed(let failed):
                SkEmptyState(String(localized: "patients.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.retry)
            case .loaded(let loaded):
                VStack(spacing: 3) {
                    ForEach(Array(loaded.items.prefix(20).enumerated()), id: \.element.id) { index, row in
                        JoinedRow(index: index, count: min(loaded.items.count, 20), action: { onPick(row.id) }) {
                            InitialsAvatar(name: row.name, size: 36, cool: index % 2 == 1)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(row.name).font(.system(size: 13.5, weight: .bold)).foregroundStyle(theme.roles.onSurface.color)
                                Text(row.subtitleText).font(.system(size: 11.5)).foregroundStyle(theme.roles.onSurfaceVariant.color)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }
}

/// Step two: the booking form, or "Booked" once the server has it.
struct BookingSheet: View {
    let holder: BookingStateHolder
    let state: BookingState
    let firstDay: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkSheetScaffold(String(localized: "t7.book.title", table: "TodayV7"), subtitle: ClinicFormat.day(iso: state.date.isoText)) {
            if !state.allowed {
                SkEmptyState(String(localized: "t7.book.not_allowed", table: "TodayV7"), message: String(localized: "walk_in.not_allowed.message"))
            } else if state.booked != nil {
                booked
            } else {
                form
            }
        }
    }

    private var booked: some View {
        VStack(spacing: 12) {
            SkCheckDraw().frame(width: 64, height: 64)
            Text("t7.book.done", tableName: "TodayV7").skTextStyle(SkTypeScale.title).foregroundStyle(theme.roles.onSurface.color)
            ForEach(state.warnings, id: \.self) { warning in
                Text(BookingLabels.warning(warning)).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.onTertiaryContainer.color)
                    .padding(8).background(theme.roles.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 12))
            }
            SkPillButton(String(localized: "t7.book.close", table: "TodayV7"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private var form: some View {
        V7Label(text: String(localized: "t7.book.doctor", table: "TodayV7"))
        FlowLayout(spacing: 8) {
            ForEach(state.doctors, id: \.id) { doctor in
                SkChoiceChip(doctor.label, selected: state.doctorId == doctor.id) { holder.chooseDoctor(id: doctor.id) }
            }
        }
        V7Label(text: String(localized: "t7.book.day", table: "TodayV7"))
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(0..<14, id: \.self) { offset in
                    let iso = DayGrid.add(days: offset, to: firstDay)
                    SkChoiceChip(ClinicFormat.day(iso: iso), selected: state.date.isoText == iso) { holder.chooseDate(date: IosDates.parse(iso)) }
                }
            }
        }
        V7Label(text: String(localized: "t7.book.kind", table: "TodayV7"))
        FlowLayout(spacing: 8) {
            ForEach(BookingLabels.kinds, id: \.1) { kind, label in
                SkChoiceChip(label, selected: state.kind == kind) { holder.chooseKind(kind: kind) }
            }
        }
        if !state.chairs.isEmpty {
            V7Label(text: String(localized: "t7.book.chair", table: "TodayV7"))
            FlowLayout(spacing: 8) {
                ForEach(state.chairs, id: \.id) { chair in
                    SkChoiceChip(chair.label, selected: state.chairId == chair.id) { holder.chooseChair(id: state.chairId == chair.id ? nil : chair.id) }
                }
            }
        }
        V7Label(text: String(localized: "t7.book.time", table: "TodayV7"))
        slots
        SkField(String(localized: "t7.book.reason", table: "TodayV7"), text: Binding(get: { state.reason }, set: { holder.setReason(text: $0) }))
        if let error = state.error { Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color) }
        SkPillButton(String(localized: "t7.book.book", table: "TodayV7"), variant: .warm, wide: true, loading: state.saving) { holder.book() }
            .disabled(!state.canBook)
    }

    @ViewBuilder private var slots: some View {
        if state.doctorId == nil {
            Text("t7.book.choose_doctor", tableName: "TodayV7").skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.onSurfaceVariant.color)
        } else if state.loadingSlots {
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity)
        } else if state.slots.isEmpty {
            Text("t7.book.no_slots", tableName: "TodayV7").skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.onSurfaceVariant.color)
        } else {
            FlowLayout(spacing: 8) {
                ForEach(state.slots, id: \.starts) { slot in
                    SkChoiceChip(ClinicFormat.time(minuteOfDay: slot.time.minuteOfDay), selected: state.chosen?.starts == slot.starts) { holder.chooseSlot(slot: slot) }
                }
            }
        }
    }
}

/// Labels for the booking form's enums.
enum BookingLabels {
    /// Every kind of visit with its label, by the name the server uses for it.
    static var kinds: [(VisitKind, String)] {
        VisitKind.allCases.map { ($0, kindLabel($0.wire)) }
    }

    static func kindLabel(_ wire: String) -> String {
        switch wire {
        case "new": String(localized: "t7.book.kind.new", table: "TodayV7")
        case "follow_up": String(localized: "t7.book.kind.follow_up", table: "TodayV7")
        case "procedure": String(localized: "t7.book.kind.procedure", table: "TodayV7")
        default: String(localized: "t7.book.kind.emergency", table: "TodayV7")
        }
    }

    static func warning(_ kind: BookingWarningKind) -> String {
        switch kind {
        case .practitionerBusy: String(localized: "t7.book.warn.busy", table: "TodayV7")
        case .practitionerOnLeave: String(localized: "t7.book.warn.leave", table: "TodayV7")
        case .outsideWorkingHours: String(localized: "t7.book.warn.hours", table: "TodayV7")
        default: String(localized: "t7.book.warn.other", table: "TodayV7")
        }
    }
}
