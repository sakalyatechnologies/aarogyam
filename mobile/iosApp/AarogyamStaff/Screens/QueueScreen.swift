import AarogyamShared
import SakalyaUI
import SwiftUI

/// Today's waiting room: Seat, Done, Left, and Start visit for doctors.
struct QueueScreen: View {
    let holder: QueueStateHolder
    let state: QueueState
    let onOpenPatient: (String) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                SkLargeTitleHeader(String(localized: "queue.title"))
                content
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { holder.refresh() }
        .task {
            for await opened in holder.opened { onOpenPatient(opened.patientId) }
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "queue.not_allowed.title"), message: String(localized: "queue.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "queue.title"), message: failed.error.message,
                actionTitle: String(localized: "try_again"), action: holder.refresh
            )
        case .loaded(let loaded):
            list(loaded)
        }
    }

    @ViewBuilder private func list(_ loaded: QueueStateLoaded) -> some View {
        if loaded.rows.isEmpty {
            SkEmptyState(String(localized: "queue.empty.title"), message: String(localized: "queue.empty.message"))
        } else {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                if let error = loaded.actionError { Text(error.message).foregroundStyle(theme.palette.dangerText.color) }
                if !loaded.waiting.isEmpty { sectionTitle("queue.waiting") }
                ForEach(loaded.waiting, id: \.id) { TokenCard(row: $0, state: loaded, holder: holder) }
                if !loaded.finished.isEmpty { sectionTitle("queue.finished") }
                ForEach(loaded.finished, id: \.id) { TokenCard(row: $0, state: loaded, holder: holder) }
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }

    private func sectionTitle(_ key: LocalizedStringKey) -> some View {
        Text(key).font(.subheadline.weight(.semibold)).foregroundStyle(theme.palette.textMuted.color)
    }
}

/// One token: number, patient, wait and doctor, with the moves its status allows.
private struct TokenCard: View {
    let row: QueueRow
    let state: QueueStateLoaded
    let holder: QueueStateHolder
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack(spacing: SkSpacing.m) {
                    Text(String(format: String(localized: "queue.token"), Int(row.tokenNumber)))
                        .font(.title2.bold()).foregroundStyle(theme.palette.primaryText.color)
                    VStack(alignment: .leading) {
                        Text(row.name).bold().foregroundStyle(theme.palette.text.color)
                        Text(detail).font(.footnote).foregroundStyle(theme.palette.textMuted.color)
                    }
                    Spacer()
                    SkChip(row.status.label, tone: row.status.tone)
                }
                if row.status.active && (state.canMove || state.canStartVisit) { actions }
            }
        }
    }

    private var detail: String {
        let wait = row.status.active ? String(format: String(localized: "queue.wait_minutes"), Int(row.waitMinutes)) : nil
        return [patientLine(number: row.number, ageYears: row.ageYears?.intValue, sex: row.sex), row.doctor, wait]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private var actions: some View {
        HStack(spacing: SkSpacing.sm) {
            if state.canStartVisit {
                SkButton(String(localized: "queue.start_visit")) { holder.startVisit(tokenId: row.id) }
            } else if state.canMove && row.status == .waiting {
                SkButton(String(localized: "queue.seat")) { holder.seat(id: row.id) }
            }
            if state.canMove {
                SkButton(String(localized: "queue.done"), variant: .secondary) { holder.done(id: row.id) }
                SkButton(String(localized: "queue.left"), variant: .secondary) { holder.left(id: row.id) }
            }
        }
        .disabled(row.busy)
    }
}

extension TokenStatus {
    var label: String {
        switch self {
        case .waiting, .unknown: String(localized: "queue.status.waiting")
        case .inChair: String(localized: "queue.status.in_chair")
        case .done: String(localized: "queue.status.done")
        case .left: String(localized: "queue.status.left")
        }
    }

    var tone: SkTone {
        switch self {
        case .waiting, .unknown: .warning
        case .inChair: .info
        case .done: .success
        case .left: .neutral
        }
    }
}
