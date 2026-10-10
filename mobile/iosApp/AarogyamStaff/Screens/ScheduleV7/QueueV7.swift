import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Queue view of the v7 Schedule: the chair board, "Waiting" tickets with live timers and the
/// day's summary chips. Seat and Start visit are real moves; the chair choice is a preview.
struct QueueV7Screen: View {
    let holder: QueueStateHolder
    let state: QueueState
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    let onWalkIn: () -> Void
    @State private var chairs = 0
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
        .task { chairs = await chairCount() }
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
        let inChair = rows.filter { $0.status == .inChair }
        let waiting = rows.filter { $0.status == .waiting }
        let free = QueueBoard.freeChairs(chairs: chairs, occupied: inChair.count, waiting: waiting.count)
        if let error = loaded.actionError {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color).padding(.top, 4)
        }
        TodaySectionHeader(title: String(localized: "t7.queue.now_serving", table: "TodayV7"))
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(inChair, id: \.id) { row in
                    ChairCard(row: row, canMove: loaded.canMove) { onOpenPatient(row.patientId) } onDone: { holder.done(id: row.id) }
                }
                ForEach(0..<free, id: \.self) { _ in
                    FreeChairCard(canSeat: loaded.canMove && !waiting.isEmpty) {
                        if let next = waiting.first { holder.seat(id: next.id) }
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .padding(.horizontal, -SkSpacing.l)
        PreviewNotice(text: String(localized: "t7.queue.chair_preview", table: "TodayV7")).padding(.top, 8)
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
        summary(rows)
    }

    private func ticket(_ row: QueueRow, _ loaded: QueueStateLoaded, elapsed: TimeInterval) -> some View {
        let minutes = QueueBoard.waitMinutes(base: Int(row.waitMinutes), elapsed: elapsed)
        return SkTicket(
            number: "#\(row.tokenNumber)", title: row.name,
            subtitle: [patientLine(number: row.number, ageYears: row.ageYears?.intValue, sex: row.sex), row.doctor].compactMap { $0 }.joined(separator: " · "),
            badge: String(format: String(localized: "t7.queue.wait", table: "TodayV7"), minutes)
        ) {
            if loaded.canStartVisit {
                SkPillButton(String(localized: "queue.start_visit"), variant: .tonal) { holder.startVisit(tokenId: row.id) }.disabled(row.busy)
            } else if loaded.canMove {
                SkPillButton(String(localized: "queue.seat"), variant: .tonal) { holder.seat(id: row.id) }.disabled(row.busy)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func summary(_ rows: [QueueRow]) -> some View {
        let s = QueueSummary.companion.of(rows: rows)
        let r = theme.roles
        var chips = [String(format: String(localized: "t7.queue.done_today", table: "TodayV7"), Int(s.done))]
        if let average = s.averageWaitMinutes { chips.append(String(format: String(localized: "t7.queue.avg_wait", table: "TodayV7"), average.intValue)) }
        if s.left > 0 { chips.append(String(format: String(localized: "t7.queue.left", table: "TodayV7"), Int(s.left))) }
        return VStack(alignment: .leading, spacing: 6) {
            FlowLayout(spacing: 6) {
                ForEach(Array(chips.enumerated()), id: \.offset) { index, chip in
                    Text(chip).font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle((index == 0 ? r.onPrimaryContainer : r.onSurfaceVariant).color)
                        .padding(.horizontal, 11).frame(minHeight: 32)
                        .background((index == 0 ? r.primaryContainer : r.surface3).color, in: Capsule())
                }
            }
            PreviewNotice(text: String(localized: "t7.queue.no_shows_preview", table: "TodayV7"))
        }
        .padding(.top, 6)
    }

    /// The clinic's chair count, from the cached reference data.
    private func chairCount() async -> Int {
        guard let result = try? await clinic.reference.rooms(), case .success(let ok) = onEnum(of: result),
              let rooms = ok.value as? [Room] else { return 0 }
        return rooms.filter { $0.kind == "chair" && $0.active }.count
    }
}

/// A chair with a patient in it: the filled card (`.chairc.busy`); a tap opens the record.
private struct ChairCard: View {
    let row: QueueRow
    let canMove: Bool
    let onOpen: () -> Void
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 6) {
                Text(String(format: String(localized: "t7.queue.in_chair", table: "TodayV7"), Int(row.tokenNumber)))
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced)).tracking(0.6).opacity(0.8)
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
}

/// An empty chair: the dashed card with "Seat next" (`.chairc.free`).
private struct FreeChairCard: View {
    let canSeat: Bool
    let onSeat: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Button(action: onSeat) {
            VStack(alignment: .leading, spacing: 6) {
                Text("t7.queue.free_chair", tableName: "TodayV7").font(.system(size: 10.5, weight: .bold, design: .monospaced)).tracking(0.6)
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
