import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Recurring section of the Expenses page: a header with Add, then one card per recurring
/// expense with the actions its status allows. Stop asks first.
struct RecurringSection: View {
    let holder: RecurringExpensesStateHolder
    let state: RecurringExpensesState
    @State private var adding = false
    @State private var stopping: String?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                RecurringLabel(text: CL("c.recur.title"))
                Spacer()
                if state.canChange {
                    Button(CL("c.recur.add")) {
                        if state.draft.saved { holder.resetDraft() }
                        adding = true
                    }
                    .font(.system(size: 13.5, weight: .bold))
                }
            }
            if let error = state.error {
                HStack {
                    Text(error.message).font(.system(size: 12.5)).foregroundStyle(r.error.color)
                    Spacer()
                    Button(String(localized: "try_again")) { holder.refresh() }.font(.system(size: 13, weight: .semibold))
                }
            } else if !state.loading && state.rows.isEmpty {
                Text(CL("c.recur.empty")).font(.system(size: 12.5)).foregroundStyle(r.onSurfaceVariant.color)
            }
            ForEach(state.rows, id: \.id) { row in
                RecurringRowView(row: row, canChange: state.canChange, idle: state.busy == nil,
                                 onPause: { holder.pause(id: row.id) }, onResume: { holder.resume(id: row.id) },
                                 onStop: { stopping = row.id })
            }
        }
        .sheet(isPresented: $adding) { RecurringSheet(holder: holder, state: state) }
        .confirmationDialog(CL("c.recur.stop_title"), isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }),
                            titleVisibility: .visible, presenting: stopping) { id in
            Button(CL("c.recur.stop"), role: .destructive) { holder.stop(id: id) }
            Button(CL("c.expenses.cancel"), role: .cancel) {}
        } message: { _ in
            Text(CL("c.recur.stop_message"))
        }
        .alert(state.actionError?.message ?? "", isPresented: Binding(get: { state.actionError != nil }, set: { if !$0 { holder.clearActionError() } })) {
            Button(CL("c.done"), role: .cancel) { holder.clearActionError() }
        }
    }
}

/// A small uppercase heading over a group of rows.
struct RecurringLabel: View {
    let text: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        Text(text.uppercased()).font(.system(size: 12, weight: .bold)).tracking(0.7)
            .foregroundStyle(theme.roles.onSurfaceVariant.color)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct RecurringRowView: View {
    let row: RecurringRow
    let canChange: Bool
    let idle: Bool
    let onPause: () -> Void
    let onResume: () -> Void
    let onStop: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                V7Icon(name: row.category.iconName, size: 19, tint: r.onTertiaryContainer.color)
                    .frame(width: 38, height: 38)
                    .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.categoryName.isEmpty ? row.category.label : row.categoryName).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                    Text(subtitle).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color).lineLimit(2)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(ClinicFormat.rupees(paise: row.amountPaise)).font(.system(size: 14, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                    SkChip(row.status.label, tone: row.status.tone)
                }
            }
            .accessibilityElement(children: .combine)
            if canChange && row.canStop {
                HStack(spacing: SkSpacing.sm) {
                    if row.canPause { SkPillButton(CL("c.recur.pause"), variant: .tonal, wide: true, action: onPause).disabled(!idle) }
                    if row.canResume { SkPillButton(CL("c.recur.resume"), variant: .tonal, wide: true, action: onResume).disabled(!idle) }
                    SkPillButton(CL("c.recur.stop"), variant: .ghost, wide: true, action: onStop).disabled(!idle)
                }
            }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var subtitle: String {
        let live = row.status == .active || row.status == .paused
        let next = live ? CLf("c.recur.next", ClinicFormat.date(iso: row.nextDue.isoText)) : nil
        return [row.cadenceText, next, row.note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

extension RecurringRow {
    /// "Monthly on day 5" or "Weekly on Mon".
    var cadenceText: String {
        switch every {
        case .monthly: CLf("c.recur.monthly_on", Int(dayOfMonth?.int32Value ?? 1))
        case .weekly: CLf("c.recur.weekly_on", RecurEvery.weekdayName(Int(weekday?.int32Value ?? 1)))
        }
    }
}

extension RecurEvery {
    var label: String {
        switch self {
        case .monthly: CL("c.recur.every_monthly")
        case .weekly: CL("c.recur.every_weekly")
        }
    }

    /// The short name of ISO weekday `day` (1 is Monday).
    static func weekdayName(_ day: Int) -> String {
        let names = ClinicalFormat.weekdayRows()
        return names.indices.contains(day - 1) ? names[day - 1] : ""
    }
}

extension RecurStatus {
    var label: String {
        switch self {
        case .active: CL("c.recur.status_active")
        case .paused: CL("c.recur.status_paused")
        case .stopped: CL("c.recur.status_stopped")
        case .ended: CL("c.recur.status_ended")
        }
    }

    var tone: SkTone {
        switch self {
        case .active: .success
        case .paused: .warning
        case .stopped, .ended: .neutral
        }
    }
}

extension RecurringProblem {
    var message: String {
        switch self {
        case .noAmount: CL("c.expenses.problem.amount")
        case .tooLarge: CL("c.expenses.problem.large")
        case .noDayOfMonth: CL("c.recur.problem_day")
        case .noWeekday: CL("c.recur.problem_weekday")
        case .startOutOfRange: CL("c.recur.problem_start")
        case .noteTooLong: CL("c.expenses.problem.note")
        }
    }
}
