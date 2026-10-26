import AarogyamShared
import SakalyaUI
import SwiftUI

/// The waiting-room board: today's patients grouped by where they are (Waiting, Called, In consult,
/// In chair, Ready to bill). It refreshes every 20 seconds while it is on screen and on pull.
/// A doctor's "Send in" calls the patient in; "My patients" filters to their own.
struct DeskBoardScreen: View {
    let holder: DeskBoardStateHolder
    let state: DeskBoardState
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    let onCollect: (DeskPayTarget) -> Void
    /// v10: live wait times, availability and pay notifications; nil keeps the v9 board.
    var feed: DeskV10Feed?
    /// True when the Desk home draws the board inside its own scroll view.
    var embedded = false
    @State private var net = V9Connectivity()
    @Environment(\.skTheme) private var theme

    private var roleKey: String { clinic.session.membership.roleKey }

    var body: some View {
        Group {
            if embedded {
                VStack(alignment: .leading, spacing: 10) { content }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        content
                    }
                    .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.xxl)
                }
                .scrollIndicators(.hidden)
                .refreshable { holder.refresh() }
            }
        }
        .task {
            // Every 20 seconds while the screen is visible; the task ends when it goes.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if !Task.isCancelled { holder.refresh() }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(dv("d9.board.not_allowed.title"), message: dv("d9.board.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(dv("d9.board.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded(let loaded):
            board(loaded)
        }
    }

    @ViewBuilder private func board(_ loaded: DeskBoardStateLoaded) -> some View {
        let tickets = loaded.tickets
        let groups = DeskBoard.groups(tickets, state: { $0.state })
        let called = tickets.filter { $0.state == .called }
        if loaded.canFilterMine {
            Toggle(isOn: Binding(get: { loaded.mine }, set: { holder.setMine(on: $0) })) {
                Text(dv("d9.board.mine")).v7Text(14, .semibold)
            }
            .tint(theme.roles.primary.color).frame(minHeight: SkSpacing.minTouchTarget)
        }
        if let error = loaded.error { notice(net.online ? error.message : dv("d9.board.offline"), error: true, detail: error) }
        else if !net.online { notice(dv("d9.board.offline"), error: true, detail: nil) }
        if DeskBoard.showsCalledBanner(roleKey: roleKey, called: called.count) { calledBanner(called) }
        ForEach(groups, id: \.state) { group in
            section(group.state, group.items, loaded)
        }
        Text(dv("d9.board.live")).v7Text(11.5).foregroundStyle(theme.roles.onSurfaceVariant.color).padding(.top, 4)
    }

    private func notice(_ text: String, error: Bool, detail: ScreenError?) -> some View {
        Text(text).v7Text(12.5, .semibold).foregroundStyle(theme.roles.onErrorContainer.color)
            .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.errorContainer.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .combine)
    }

    /// "Patient called in": the desk's alert, above the board.
    private func calledBanner(_ called: [BoardTicket]) -> some View {
        let r = theme.roles
        // Token numbers only, never names (R12).
        let who = DeskV10Banner.calledText(tokens: called.map { Int($0.tokenNumber) })
        return HStack(alignment: .top, spacing: 10) {
            V7Icon(name: "bell", size: 22, tint: r.onPrimary.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(dv("d9.board.banner.title")).v7Text(15, .heavy)
                Text(who).v7Text(12.5)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(r.onPrimary.color)
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(r.primary.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private func section(_ group: PatientState, _ items: [BoardTicket], _ loaded: DeskBoardStateLoaded) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text(group.title).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.roles.onSurface.color)
                Text("\(items.count)").v7Text(12, .bold).foregroundStyle(theme.roles.onSurfaceVariant.color)
                    .padding(.horizontal, 9).frame(minHeight: 22).background(theme.roles.surface3.color, in: Capsule())
            }
            .accessibilityElement(children: .combine).accessibilityAddTraits(.isHeader)
            if items.isEmpty {
                Text(dv("d9.board.empty")).v7Text(12.5).foregroundStyle(theme.roles.onSurfaceVariant.color).padding(.horizontal, 2)
            }
            ForEach(items, id: \.id) { ticket($0, loaded) }
        }
        .padding(.top, 6)
    }

    @ViewBuilder private func ticket(_ row: BoardTicket, _ loaded: DeskBoardStateLoaded) -> some View {
        if row.state == .waiting, let wait = feed?.waiting[row.id] {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let seconds = DeskV10Wait.elapsed(since: wait.issuedAt, now: context.date)
                VStack(alignment: .leading, spacing: 6) {
                    card(row, loaded, badge: DeskV10Wait.waitingLine(doctor: wait.doctor, seconds: seconds), note: nil)
                    if DeskV10Wait.isNoReply(seconds: seconds) {
                        SkChip(DeskV10Wait.checkLine(doctor: wait.doctor), tone: .warning)
                            .padding(.horizontal, 6)
                            .accessibilityLabel(DeskV10Wait.checkLine(doctor: wait.doctor))
                    }
                }
            }
        } else {
            let collecting = row.state == .readyToBill && (feed?.endedAt[row.id]).map {
                DeskV10Collect.mayBeCollecting(status: "ready_to_bill", endedAt: $0, now: Date())
            } ?? false
            card(row, loaded, badge: dvf("d9.board.wait", Int(row.waitMinutes)), note: collecting ? dx("dx.pay.may_collect") : nil)
        }
    }

    private func card(_ row: BoardTicket, _ loaded: DeskBoardStateLoaded, badge: String, note: String?) -> some View {
        let r = theme.roles
        let highlighted = row.state == .called
        return VStack(alignment: .leading, spacing: 4) {
            SkTicket(
                number: "#\(row.tokenNumber)", title: row.name,
                subtitle: [patientLine(number: row.number, ageYears: row.ageYears?.intValue, sex: row.sex), row.doctor].compactMap { $0 }.joined(separator: " · "),
                badge: badge
            ) {
                if DeskBoard.showsSendIn(roleKey: roleKey, state: row.state) {
                    SkPillButton(dv("d9.board.send_in"), variant: .tonal) { holder.sendIn(tokenId: row.id) }
                        .disabled(loaded.calling.contains(row.id)).accessibilityLabel(dvf("d9.board.send_in.a11y", row.name))
                } else if row.state == .readyToBill, clinic.permissions.contains("billing.write") {
                    SkPillButton(dv("d9.board.collect"), variant: .tonal) {
                        onCollect(DeskPayTarget(patientId: row.patientId, name: row.name, notificationId: feed?.payNotification[row.id], invoiceId: feed?.payInvoice[row.id]))
                    }
                }
            }
            .overlay {
                if highlighted {
                    RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(r.primary.color, lineWidth: 2.5)
                }
            }
            if let note {
                Text(note).v7Text(12, .semibold).foregroundStyle(r.onSurfaceVariant.color).padding(.horizontal, 8)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onOpenPatient(row.patientId) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(row.state.title), #\(row.tokenNumber), \(row.name)")
        .accessibilityValue([row.state == .waiting ? badge : nil, note].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(highlighted ? .isSelected : [])
    }
}
