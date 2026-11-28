import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the sheet shows: the actions, the cancel reason, or the new time.
private enum ApptMode { case menu, cancel, reschedule }

/// The tapped appointment's actions: Confirm, Reschedule, Cancel, Mark no-show and Call, on the shared holders.
struct AppointmentActionsView: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let entry: CalendarEntry
    /// Reloads the day after a change.
    let onChanged: () -> Void
    let onOpenPatient: () -> Void
    let onClose: () -> Void
    @State private var mode = ApptMode.menu

    var body: some View {
        switch mode {
        case .reschedule:
            RescheduleView(graph: graph, clinic: clinic, entry: entry, onChanged: onChanged, onClose: onClose) { mode = .menu }
        default:
            ScreenHost(
                make: { graph.appointmentActions(clinic: clinic, entry: entry, screen: $0, onChanged: onChanged) },
                state: { $0.state }
            ) { holder, state in
                menu(holder, state)
            }
        }
    }

    private func menu(_ holder: AppointmentActionsHolder, _ state: ApptActionState) -> some View {
        MenuBody(entry: entry, holder: holder, state: state, cancelling: mode == .cancel, onOpenPatient: onOpenPatient, onClose: onClose,
                 onCancelStep: { mode = .cancel }, onReschedule: { mode = .reschedule }, onBack: { mode = .menu })
    }
}

private struct MenuBody: View {
    let entry: CalendarEntry
    let holder: AppointmentActionsHolder
    let state: ApptActionState
    let cancelling: Bool
    let onOpenPatient: () -> Void
    let onClose: () -> Void
    let onCancelStep: () -> Void
    let onReschedule: () -> Void
    let onBack: () -> Void
    @State private var reason = ""
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            if cancelling { cancelForm } else { actions }
            if state.noPhone { note(String(localized: "appt.no_phone")) }
            if let error = state.error { note(error.message, error: true) }
        }
        .onChange(of: state.done) { _, done in if done != nil { onClose() } }
        .onChange(of: state.dial) { _, number in
            guard let number else { return }
            if let url = PatientLinks.tel(number) { openURL(url) }
            holder.dialed()
        }
        .alert(String(localized: "appt.taken_title"), isPresented: Binding(get: { state.askDoubleBook }, set: { if !$0 { holder.dismissDoubleBook() } })) {
            Button(String(localized: "appt.taken_yes")) { holder.confirmAnyway() }
            Button(String(localized: "appt.taken_no"), role: .cancel) { holder.dismissDoubleBook() }
        }
    }

    @ViewBuilder private var actions: some View {
        let offered = holder.actions()
        AppointmentDetail(entry: entry, onOpenPatient: onOpenPatient)
        if entry.online {
            Text("appt.badge").skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.onTertiaryContainer.color)
        }
        ForEach(offered, id: \.self) { action in
            switch action {
            case .confirm: SkPillButton(String(localized: "appt.confirm"), variant: .warm, wide: true, loading: state.busy) { holder.confirm() }
            case .reschedule: SkPillButton(String(localized: "appt.reschedule"), variant: .tonal, wide: true, action: onReschedule)
            case .cancel: SkPillButton(String(localized: "appt.cancel"), variant: .ghost, wide: true, action: onCancelStep)
            case .noShow: SkPillButton(String(localized: "appt.no_show"), variant: .ghost, wide: true, loading: state.busy) { holder.noShow() }
            case .call: SkPillButton(String(localized: "appt.call"), variant: .tonal, wide: true, loading: state.busy) { holder.call() }
            }
        }
    }

    @ViewBuilder private var cancelForm: some View {
        Text("appt.cancel_title").skTextStyle(SkTypeScale.title).foregroundStyle(theme.roles.onSurface.color)
        FlowLayout(spacing: 8) {
            ForEach(Self.chips, id: \.0) { text, label in
                SkChoiceChip(label, selected: reason == text) { reason = text }
            }
        }
        SkField(String(localized: "appt.cancel_reason"), text: $reason)
        SkPillButton(String(localized: "appt.cancel_submit"), variant: .warm, wide: true, loading: state.busy) { holder.cancel(reason: reason) }
            .disabled(reason.trimmingCharacters(in: .whitespaces).isEmpty)
        SkPillButton(String(localized: "appt.back"), variant: .ghost, wide: true, action: onBack)
    }

    private static var chips: [(String, String)] {
        [
            (CancelReason.patientAsked.text, String(localized: "appt.cancel_patient")),
            (CancelReason.doctorUnavailable.text, String(localized: "appt.cancel_doctor")),
            (CancelReason.duplicate.text, String(localized: "appt.cancel_duplicate")),
        ]
    }

    private func note(_ text: String, error: Bool = false) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote)
            .foregroundStyle(error ? theme.roles.error.color : theme.roles.onSurfaceVariant.color)
    }
}

/// Pick a new day, doctor and free slot for the appointment, with the booking sheet's chips.
private struct RescheduleView: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let entry: CalendarEntry
    let onChanged: () -> Void
    let onClose: () -> Void
    let onBack: () -> Void

    var body: some View {
        let today = LabFormat.today(zone: clinic.session.clinic.timezone)
        ScreenHost(
            make: { graph.reschedule(clinic: clinic, entry: entry, date: BookingDays.date(today), screen: $0, onChanged: onChanged) },
            state: { $0.state }
        ) { holder, state in
            RescheduleBody(holder: holder, state: state, today: today, onClose: onClose, onBack: onBack)
        }
    }
}

private struct RescheduleBody: View {
    let holder: RescheduleStateHolder
    let state: RescheduleState
    let today: String
    let onClose: () -> Void
    let onBack: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            Text("appt.move_title").skTextStyle(SkTypeScale.title).foregroundStyle(theme.roles.onSurface.color)
            V7Label(text: String(localized: "t7.book.doctor", table: "TodayV7"))
            FlowLayout(spacing: 8) {
                ForEach(state.doctors, id: \.id) { doctor in
                    SkChoiceChip(doctor.label, selected: state.doctorId == doctor.id) { holder.chooseDoctor(id: doctor.id) }
                }
            }
            V7Label(text: String(localized: "t7.book.day", table: "TodayV7"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(BookingDays.next(14, from: today), id: \.self) { iso in
                        SkChoiceChip(ClinicFormat.day(iso: iso), selected: state.date.isoText == iso) { holder.chooseDate(date: IosDates.parse(iso)) }
                    }
                }
            }
            V7Label(text: String(localized: "t7.book.time", table: "TodayV7"))
            slots
            if let error = state.error { Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color) }
            SkPillButton(String(localized: "appt.move_submit"), variant: .warm, wide: true, loading: state.saving) { holder.move() }
                .disabled(!state.canMove)
            SkPillButton(String(localized: "appt.back"), variant: .ghost, wide: true, action: onBack)
        }
        .onChange(of: state.moved) { _, moved in if moved { onClose() } }
    }

    @ViewBuilder private var slots: some View {
        if state.loadingSlots {
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
