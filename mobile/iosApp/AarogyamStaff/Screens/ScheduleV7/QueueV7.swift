import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Queue view of the v7 Schedule: the chair board, "Waiting" tickets with live timers and the
/// day's summary chips. Each chair shows its patient; "Seat next" on a free chair seats the next
/// patient in that chair.
struct QueueV7Screen: View {
    let holder: QueueStateHolder
    let state: QueueState
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    let onWalkIn: () -> Void
    @State private var readAt = Date()
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { holder.refresh() }
        .onChange(of: waitSignature) { readAt = Date() }
        .task {
            for await opened in holder.opened { onOpenPatient(opened.patientId) }
        }
    }

    /// Changes whenever the server's wait times do, so the live timers restart from them.
    private var waitSignature: String {
        if case .loaded(let loaded) = onEnum(of: state) { loaded.rows.map { "\($0.id)\($0.waitMinutes)\($0.status)" }.joined(separator: ",") } else { "" }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "queue.not_allowed.title"), message: String(localized: "queue.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(String(localized: "queue.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded(let loaded):
            board(loaded)
        }
    }

    @ViewBuilder private func board(_ loaded: QueueStateLoaded) -> some View {
        let rows = loaded.rows
        let waiting = rows.filter { $0.status == .waiting || $0.status == .called }
        let toBill = rows.filter { $0.status == .readyToBill }
        if let error = loaded.actionError {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color).padding(.top, 4)
        }
        ArrivalsStrip(holder: holder.arrivals)
        TodaySectionHeader(title: String(localized: "t7.queue.now_serving", table: "TodayV7"))
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(loaded.board.enumerated()), id: \.offset) { _, slot in
                    if let row = slot.occupant {
                        ChairCard(row: row, chair: slot.chair?.name, canMove: loaded.canMove) { onOpenPatient(row.patientId) } onDone: { holder.done(id: row.id) }
                    } else {
                        let canSeat = loaded.canMove && rows.contains { $0.status == .waiting && (slot.chair == nil || $0.branchId == slot.chair?.branchId) }
                        FreeChairCard(chair: slot.chair?.name, canSeat: canSeat) { holder.seatNextIn(chairId: slot.chair?.id) }
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .padding(.horizontal, -SkSpacing.l)
        TodaySectionHeader(
            title: String(format: String(localized: "t7.queue.waiting", table: "TodayV7"), waiting.count),
            action: String(localized: "t7.queue.walk_in", table: "TodayV7"), onAction: onWalkIn
        )
        if waiting.isEmpty {
            Text("t7.queue.nobody", tableName: "TodayV7").skTextStyle(SkTypeScale.body).foregroundStyle(theme.roles.onSurfaceVariant.color)
                .padding(.horizontal, 2)
        }
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(spacing: 7) {
                ForEach(waiting, id: \.id) { row in
                    ticket(row, loaded, elapsed: context.date.timeIntervalSince(readAt))
                }
            }
        }
        ForEach(toBill, id: \.id) { row in
            ticket(row, loaded, elapsed: 0)
        }
        summary(rows, noShows: loaded.noShows?.intValue)
    }

    private func ticket(_ row: QueueRow, _ loaded: QueueStateLoaded, elapsed: TimeInterval) -> some View {
        let minutes = QueueBoard.waitMinutes(base: Int(row.waitMinutes), elapsed: elapsed)
        return SkTicket(
            number: "#\(row.tokenNumber)", title: row.name,
            subtitle: [patientLine(number: row.number, ageYears: row.ageYears?.intValue, sex: row.sex), row.doctor].compactMap { $0 }.joined(separator: " · "),
            badge: row.status == .waiting ? String(format: String(localized: "t7.queue.wait", table: "TodayV7"), minutes) : row.status.label
        ) {
            if row.status == .readyToBill {
                EmptyView()
            } else if loaded.canStartVisit {
                SkPillButton(String(localized: "queue.start_visit"), variant: .tonal) { holder.startVisit(tokenId: row.id) }.disabled(row.busy)
            } else if loaded.canMove {
                SkPillButton(String(localized: "queue.seat"), variant: .tonal) { holder.seat(id: row.id) }.disabled(row.busy)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func summary(_ rows: [QueueRow], noShows: Int?) -> some View {
        let s = QueueSummary.companion.of(rows: rows)
        let r = theme.roles
        var chips = [String(format: String(localized: "t7.queue.done_today", table: "TodayV7"), Int(s.done))]
        if let average = s.averageWaitMinutes { chips.append(String(format: String(localized: "t7.queue.avg_wait", table: "TodayV7"), average.intValue)) }
        if s.left > 0 { chips.append(String(format: String(localized: "t7.queue.left", table: "TodayV7"), Int(s.left))) }
        if let noShows, noShows > 0 { chips.append(String(format: String(localized: "t7.queue.no_shows", table: "TodayV7"), noShows)) }
        return VStack(alignment: .leading, spacing: 6) {
            FlowLayout(spacing: 6) {
                ForEach(Array(chips.enumerated()), id: \.offset) { index, chip in
                    Text(chip).font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle((index == 0 ? r.onPrimaryContainer : r.onSurfaceVariant).color)
                        .padding(.horizontal, 11).frame(minHeight: 32)
                        .background((index == 0 ? r.primaryContainer : r.surface3).color, in: Capsule())
                }
            }
        }
        .padding(.top, 6)
    }

}

/// A chair with a patient in it: the filled card (`.chairc.busy`); a tap opens the record.
private struct ChairCard: View {
    let row: QueueRow
    let chair: String?
    let canMove: Bool
    let onOpen: () -> Void
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 6) {
                Text(kicker)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced)).tracking(0.6).opacity(0.8).lineLimit(1)
                Text(row.name).font(.system(size: 13, weight: .bold)).lineLimit(2).multilineTextAlignment(.leading)
                if let doctor = row.doctor { Text(doctor).font(.system(size: 11)).opacity(0.8).lineLimit(1) }
                if canMove {
                    Text("queue.done").font(.system(size: 11, weight: .bold)).foregroundStyle(r.primary.color)
                        .padding(.horizontal, 10).frame(minHeight: 28).background(Color.white, in: Capsule())
                        .onTapGesture(perform: onDone)
                        .accessibilityAddTraits(.isButton)
                }
            }
            .foregroundStyle(r.onPrimary.color)
            .padding(11)
            .frame(width: 132, alignment: .leading)
            .frame(minHeight: 96, alignment: .topLeading)
            .background(r.primary.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .disabled(row.busy)
    }

    /// "CHAIR 2 · #7", or "IN CHAIR · #7" for a patient seated with no chair.
    private var kicker: String {
        if let chair { return "\(chair.uppercased()) · #\(row.tokenNumber)" }
        return String(format: String(localized: "t7.queue.in_chair", table: "TodayV7"), Int(row.tokenNumber))
    }
}

/// An empty chair: the dashed card with "Seat next" (`.chairc.free`).
private struct FreeChairCard: View {
    let chair: String?
    let canSeat: Bool
    let onSeat: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Button(action: onSeat) {
            VStack(alignment: .leading, spacing: 6) {
                Text(chair?.uppercased() ?? String(localized: "t7.queue.free_chair", table: "TodayV7"))
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced)).tracking(0.6).lineLimit(1)
                    .foregroundStyle(r.onSurface.color).opacity(0.8)
                Text("t7.queue.free", tableName: "TodayV7").font(.system(size: 13, weight: .bold)).foregroundStyle(r.onSurface.color)
                if canSeat {
                    Text("t7.queue.seat_next", tableName: "TodayV7").font(.system(size: 11, weight: .bold)).foregroundStyle(r.primary.color)
                }
            }
            .padding(11)
            .frame(width: 132, alignment: .leading)
            .frame(minHeight: 96, alignment: .topLeading)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(r.outline.color, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
        }
        .buttonStyle(.skPressable)
        .disabled(!canSeat)
    }
}
