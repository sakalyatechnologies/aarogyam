import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Day view of the v7 Schedule: a week strip, doctors or chairs side by side down the hours,
/// the "now" line, and a tap for an appointment's details.
struct DayV7Screen: View {
    let holder: CalendarStateHolder
    let state: CalendarState
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    @State private var detail: CalendarEntry?
    @Environment(\.skTheme) private var theme

    private var loaded: CalendarStateLoaded? { if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                switch onEnum(of: state) {
                case .notAllowed:
                    SkEmptyState(String(localized: "calendar.not_allowed.title"), message: String(localized: "calendar.not_allowed.message"))
                case .loading:
                    SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .failed(let failed):
                    SkEmptyState(String(localized: "calendar.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    day(loaded)
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { holder.refresh() }
        .simultaneousGesture(swipe)
        .skSheet(
            isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } }),
            title: detail?.patientName ?? "", subtitle: detail?.patientNumber
        ) {
            if let entry = detail { AppointmentDetail(entry: entry) { detail = nil; onOpenPatient(entry.patientId) } }
        }
    }

    /// Left for the next day, right for the previous one; mostly-vertical drags are left to scrolling.
    private var swipe: some Gesture {
        DragGesture(minimumDistance: 40).onEnded { drag in
            guard abs(drag.translation.width) > 100, abs(drag.translation.width) > abs(drag.translation.height) * 2 else { return }
            if drag.translation.width < 0 { holder.next() } else { holder.previous() }
        }
    }

    @ViewBuilder private func day(_ loaded: CalendarStateLoaded) -> some View {
        let iso = loaded.date.isoText
        dayStrip(iso)
        SkSegmented(
            [String(localized: "calendar.by_doctor"), String(localized: "calendar.by_chair")],
            selectedIndex: loaded.mode == .chair ? 1 : 0
        ) { holder.setMode(newMode: $0 == 0 ? .doctor : .chair) }
        if let error = loaded.error { Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color) }
        if loaded.entries.isEmpty {
            SkEmptyState(String(localized: "calendar.empty.title"), message: String(localized: "calendar.empty.message"))
        } else {
            DayColumns(loaded: loaded, clinic: clinic) { detail = $0 }
        }
    }

    private func dayStrip(_ iso: String) -> some View {
        let r = theme.roles
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(DayGrid.week(iso: iso).enumerated()), id: \.offset) { _, day in
                    let on = day == iso
                    Button { holder.show(target: IosDates.parse(day)) } label: {
                        VStack(spacing: 2) {
                            Text(ClinicFormat.weekdayShort(iso: day)).font(.system(size: 11.5, weight: .bold))
                                .foregroundStyle(on ? r.onPrimary.color : r.onSurfaceVariant.color)
                            Text(String(Int(day.suffix(2)) ?? 0)).font(.system(size: 18, weight: .heavy)).monospacedDigit()
                                .foregroundStyle(on ? r.onPrimary.color : r.onSurface.color)
                        }
                        .frame(width: 52).padding(.vertical, 8)
                        .background((on ? r.primary : r.surface2).color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .offset(y: on ? -2 : 0)
                    }
                    .buttonStyle(.skPressable)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .padding(.horizontal, -SkSpacing.l)
        .animation(SkMotionTokens.pressSpring.animation, value: iso)
    }
}

/// Doctors or chairs as columns down the clinic hours, appointments as blocks (`.cgrid`).
private struct DayColumns: View {
    let loaded: CalendarStateLoaded
    let clinic: ClinicContext
    let onSelect: (CalendarEntry) -> Void
    @Environment(\.skTheme) private var theme

    private struct Column: Identifiable {
        let id: String
        let name: String
        let entries: [CalendarEntry]
    }

    private var columns: [Column] {
        let byDoctor = loaded.mode == .doctor
        let entries = loaded.entries
        var result = loaded.columns.map { col in
            Column(id: col.id, name: col.name, entries: entries.filter { (byDoctor ? $0.practitionerId : $0.roomId) == col.id })
        }
        let placed = Set(result.flatMap { $0.entries.map(\.appointmentId) })
        let rest = entries.filter { !placed.contains($0.appointmentId) }
        if !rest.isEmpty { result.append(Column(id: "-", name: String(localized: "t7.day.unassigned", table: "TodayV7"), entries: rest)) }
        return result.filter { !$0.entries.isEmpty || loaded.selected == nil && result.count <= 3 }
    }

    var body: some View {
        let cols = columns
        let hours = DayGrid.hours(starts: loaded.entries.map { Int($0.starts.minuteOfDay) }, ends: loaded.entries.map { Int($0.ends.minuteOfDay) })
        let grid = HStack(alignment: .top, spacing: 6) {
            hourLabels(hours)
            ForEach(cols) { col in
                if cols.count <= 3 { column(col, hours: hours).frame(maxWidth: .infinity) } else { column(col, hours: hours).frame(width: 112) }
            }
        }
        .overlay(alignment: .topLeading) { nowLine(hours) }
        if cols.count <= 3 {
            grid
        } else {
            ScrollView(.horizontal, showsIndicators: false) { grid }
        }
    }

    private func hourLabels(_ hours: ClosedRange<Int>) -> some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 22)
            ForEach(Array(hours), id: \.self) { hour in
                Color.clear.frame(width: 34, height: DayGrid.hourHeight)
                    .overlay(alignment: .topLeading) {
                        Text(DayGrid.hourLabel(hour)).font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(theme.roles.onSurfaceVariant.color).padding(.top, 2)
                    }
                    .overlay(alignment: .top) { Rectangle().fill(theme.roles.outline.color).frame(height: 1) }
            }
        }
        .frame(width: 34)
    }

    private func column(_ col: Column, hours: ClosedRange<Int>) -> some View {
        VStack(spacing: 0) {
            Text(col.name.uppercased()).font(.system(size: 10.5, weight: .bold, design: .monospaced)).tracking(0.4)
                .foregroundStyle(theme.roles.onSurfaceVariant.color).lineLimit(1).frame(height: 22)
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(Array(hours), id: \.self) { _ in
                        Rectangle().fill(.clear).frame(height: DayGrid.hourHeight)
                            .overlay(alignment: .top) { Rectangle().fill(theme.roles.outline.color).frame(height: 1) }
                    }
                }
                GeometryReader { box in
                    let lanes = DayGrid.lanes(col.entries.map { (Int($0.starts.minuteOfDay), Int($0.ends.minuteOfDay)) })
                    ForEach(Array(col.entries.enumerated()), id: \.element.appointmentId) { index, entry in
                        let f = DayGrid.frame(start: Int(entry.starts.minuteOfDay), end: Int(entry.ends.minuteOfDay), firstHour: hours.lowerBound)
                        let lane = lanes[index]
                        let width = box.size.width / CGFloat(lane.count)
                        block(entry).frame(width: width - (lane.count > 1 ? 2 : 0), height: f.height)
                            .offset(x: width * CGFloat(lane.lane), y: f.top)
                    }
                }
            }
        }
    }

    private func block(_ entry: CalendarEntry) -> some View {
        let r = theme.roles
        let (bg, ink): (SkRGB, SkRGB) = switch DayGrid.tone(entry.status) {
        case .normal: (r.primaryContainer, r.onPrimaryContainer)
        case .warm: (r.tertiaryContainer, r.onTertiaryContainer)
        case .finished: (r.surface3, r.onSurfaceVariant)
        }
        return Button { onSelect(entry) } label: {
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.patientName).font(.system(size: 11.5, weight: .bold)).lineLimit(1)
                if let reason = entry.reason { Text(reason).font(.system(size: 11)).lineLimit(1) }
            }
            .foregroundStyle(ink.color)
            .padding(.horizontal, 7).padding(.vertical, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(bg.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.skPressable)
    }

    @ViewBuilder private func nowLine(_ hours: ClosedRange<Int>) -> some View {
        if loaded.isToday, let zone = TimeZone(identifier: clinic.session.clinic.timezone) {
            var calendar = Calendar(identifier: .gregorian)
            let _ = calendar.timeZone = zone
            let parts = calendar.dateComponents([.hour, .minute], from: Date())
            if let y = DayGrid.nowOffset(minute: (parts.hour ?? 0) * 60 + (parts.minute ?? 0), hours: hours) {
                Rectangle().fill(theme.roles.error.color).frame(height: 2).padding(.leading, 34)
                    .overlay(alignment: .leading) { Circle().fill(theme.roles.error.color).frame(width: 9, height: 9).offset(x: 30) }
                    .offset(y: y + 22).allowsHitTesting(false)
            }
        }
    }
}

/// An appointment's details (the sheet a block opens).
struct AppointmentDetail: View {
    let entry: CalendarEntry
    let onOpenPatient: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            StatusPill(pill: TodayV7.Pill(entry.status))
            line(nil, entry.rangeText)
            line("appointment.doctor", entry.practitioner)
            if let room = entry.room { line("appointment.room", room) }
            if let reason = entry.reason { line("appointment.reason", reason) }
            if let notes = entry.notes { line("appointment.notes", notes) }
            SkPillButton(String(localized: "open_patient"), wide: true, action: onOpenPatient).padding(.top, SkSpacing.l)
        }
    }

    private func line(_ label: String.LocalizationValue?, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: SkSpacing.xxs) {
            if let label { Text(String(localized: label)).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.onSurfaceVariant.color) }
            Text(value).skTextStyle(SkTypeScale.body).foregroundStyle(theme.roles.onSurface.color)
        }
    }
}
