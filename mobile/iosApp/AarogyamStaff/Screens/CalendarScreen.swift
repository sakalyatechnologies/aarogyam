import AarogyamShared
import SakalyaUI
import SwiftUI

/// The day view: swipe or tap the arrows between days, split by doctor or chair, tap for details.
struct CalendarScreen: View {
    let holder: CalendarStateHolder
    let state: CalendarState
    let onOpenPatient: (String) -> Void
    @State private var detail: CalendarEntry?
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                SkLargeTitleHeader(String(localized: "calendar.title"), subtitle: loaded.map { ClinicFormat.day(iso: $0.date.isoText) })
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(String(localized: "calendar.not_allowed.title"), message: String(localized: "calendar.not_allowed.message"))
                } else {
                    controls
                    content
                }
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { await refresh() }
        .simultaneousGesture(swipe)
        .skSheet(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } }), title: detail?.patientName ?? "", subtitle: detail?.patientNumber) {
            if let entry = detail {
                AppointmentDetail(entry: entry) {
                    detail = nil
                    onOpenPatient(entry.patientId)
                }
            }
        }
    }

    private var loaded: CalendarStateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    /// Left for the next day, right for the previous one; mostly-vertical drags are left to scrolling.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 40).onEnded { drag in
            guard abs(drag.translation.width) > 100, abs(drag.translation.width) > abs(drag.translation.height) * 2 else { return }
            if drag.translation.width < 0 { holder.next() } else { holder.previous() }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            HStack {
                Button { holder.previous() } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel(Text("calendar.previous"))
                Spacer()
                Button(String(localized: "calendar.today")) { holder.goToToday() }
                Spacer()
                Button { holder.next() } label: { Image(systemName: "chevron.right") }
                    .accessibilityLabel(Text("calendar.next"))
            }
            .frame(minHeight: SkSpacing.minTouchTarget)
            SkSegmentedControl(
                [String(localized: "calendar.by_doctor"), String(localized: "calendar.by_chair")],
                selection: Binding(
                    get: { loaded?.mode == .chair ? 1 : 0 },
                    set: { holder.setMode(newMode: $0 == 0 ? .doctor : .chair) }
                )
            )
            if let loaded, !loaded.columns.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SkSpacing.s) {
                        ForEach(loaded.columns, id: \.id) { column in
                            Button { holder.select(id: column.id) } label: {
                                SkChip("\(column.name) (\(column.count))", tone: loaded.selected == column.id ? .brand : .neutral)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(loaded.selected == column.id ? .isSelected : [])
                        }
                    }
                }
            }
        }
        .padding(.horizontal, SkSpacing.l)
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .notAllowed:
            EmptyView()
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .failed(let failed):
            SkEmptyState(
                String(localized: "calendar.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            day(loaded)
        }
    }

    @ViewBuilder private func day(_ loaded: CalendarStateLoaded) -> some View {
        if let error = loaded.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
                .padding(.horizontal, SkSpacing.l)
        }
        if loaded.entries.isEmpty {
            SkEmptyState(String(localized: "calendar.empty.title"), message: String(localized: "calendar.empty.message"))
        } else {
            SkCard(padding: SkSpacing.xs) {
                ForEach(Array(loaded.entries.enumerated()), id: \.element.appointmentId) { index, entry in
                    if index > 0 { SkDivider() }
                    Button { detail = entry } label: {
                        SkListRow(entry.patientName, subtitle: entry.subtitleText) {
                            SkAvatar(entry.patientName, tone: entry.status.tone)
                        } trailing: {
                            SkChip(entry.status.label.uppercased(), tone: entry.status.tone)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? CalendarStateLoaded, now.refreshing { continue }
            break
        }
    }
}

private struct AppointmentDetail: View {
    let entry: CalendarEntry
    let onOpenPatient: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            SkChip(entry.status.label.uppercased(), tone: entry.status.tone)
            line(nil, entry.rangeText)
            line("appointment.doctor", entry.practitioner)
            if let room = entry.room { line("appointment.room", room) }
            if let reason = entry.reason { line("appointment.reason", reason) }
            if let notes = entry.notes { line("appointment.notes", notes) }
            SkButton(String(localized: "open_patient"), action: onOpenPatient)
                .padding(.top, SkSpacing.l)
        }
    }

    private func line(_ label: String.LocalizationValue?, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: SkSpacing.xxs) {
            if let label {
                Text(String(localized: label)).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
            }
            Text(value).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color)
        }
    }
}
