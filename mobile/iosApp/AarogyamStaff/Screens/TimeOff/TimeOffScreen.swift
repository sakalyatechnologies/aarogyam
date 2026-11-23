import AarogyamShared
import SakalyaUI
import SwiftUI

/// Time off: the person's own requests with their status, a "Request time off" sheet, and for
/// `time_off.manage` a Pending section with Approve and Decline.
struct TimeOffScreen: View {
    let holder: any TimeOffHolder
    let state: TimeOffState
    let clinic: ClinicContext
    @Environment(\.skTheme) private var theme
    @State private var asking = false

    var body: some View {
        let r = theme.roles
        let canAsk = clinic.permissions.contains("time_off.request")
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !canAsk && !state.canManage {
                    Text("timeoff.not_allowed", tableName: "TimeOffV10").skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
                } else if state.loading {
                    SkLoadingIndicator(TimeOffV10.t("timeoff.loading")).frame(maxWidth: .infinity)
                } else if let e = state.loadError {
                    Text(e.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color)
                    SkPillButton(TimeOffV10.t("timeoff.retry"), variant: .tonal) { holder.refresh() }
                } else {
                    if canAsk {
                        SkPillButton(TimeOffV10.t("timeoff.request"), variant: .fill, wide: true) { asking = true }
                    }
                    if !state.pending.isEmpty {
                        section("timeoff.pending")
                        ForEach(state.pending, id: \.id) { row in
                            TimeOffRowView(row: row, zone: TimeOffV10.zone(clinic), onApprove: { holder.approve(id: row.id, note: nil) }, onDecline: { holder.decline(id: row.id, note: nil) })
                        }
                    }
                    section("timeoff.mine")
                    if state.mine.isEmpty { SkEmptyState(TimeOffV10.t("timeoff.empty"), message: "") }
                    ForEach(state.mine, id: \.id) { row in
                        TimeOffRowView(row: row, zone: TimeOffV10.zone(clinic), onWithdraw: { holder.cancel(id: row.id) })
                    }
                }
            }
            .padding(16)
        }
        .refreshable { holder.refresh() }
        .background(r.background.color)
        .navigationTitle(TimeOffV10.t("timeoff.title"))
        .sheet(isPresented: $asking) {
            TimeOffRequestSheet(holder: holder, state: state, zone: TimeOffV10.zone(clinic)) { asking = false }
        }
    }

    private func section(_ key: String.LocalizationValue) -> some View {
        Text(TimeOffV10.t(key)).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(theme.roles.onSurface.color).accessibilityAddTraits(.isHeader)
    }
}

/// One request: who or when, its status chip, the kind, and the actions that apply.
private struct TimeOffRowView: View {
    let row: TimeOffRow
    let zone: TimeZone
    var onWithdraw: (() -> Void)?
    var onApprove: (() -> Void)?
    var onDecline: (() -> Void)?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let days = TimeOffV10.rangeLabel(first: row.firstDay, last: row.lastDay, zone: zone)
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.memberName ?? days).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(r.onSurface.color)
                    if row.memberName != nil { Text(days).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color) }
                }
                Spacer(minLength: 0)
                V7Pill(text: TimeOffV10.statusLabel(row.status), kind: pillKind)
            }
            Text(TimeOffV10.kindLabel(row.kind)).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
            if let reason = row.reason { Text(reason).v7Text(13).foregroundStyle(r.onSurface.color) }
            if let note = row.decisionNote {
                Text(String(format: TimeOffV10.t("timeoff.decision_note"), note)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
            }
            if row.error != nil {
                Text("timeoff.action_failed", tableName: "TimeOffV10").v7Text(12.5, .semibold).foregroundStyle(r.error.color)
            }
            if row.busy {
                ProgressView()
            } else {
                HStack(spacing: 8) {
                    if let onApprove { SkPillButton(TimeOffV10.t("timeoff.approve"), variant: .fill, action: onApprove) }
                    if let onDecline { SkPillButton(TimeOffV10.t("timeoff.decline"), variant: .tonal, action: onDecline) }
                    if let onWithdraw, row.canCancel { SkPillButton(TimeOffV10.t("timeoff.withdraw"), variant: .tonal, action: onWithdraw) }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private var pillKind: V7Pill.Kind {
        switch row.status {
        case .pending: .warm
        case .approved: .done
        case .declined: .error
        case .cancelled: .neutral
        }
    }
}
