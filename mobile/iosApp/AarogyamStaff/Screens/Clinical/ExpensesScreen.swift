import AarogyamShared
import SakalyaUI
import SwiftUI

/// The month's expenses: a total card, then one row per expense, voided ones struck through.
/// "Add" opens the keypad sheet over the same state holder, so the list gains the new row.
struct ExpensesScreen: View {
    let holder: ExpensesStateHolder
    let state: ExpensesState
    /// Whether this page has its own Add button (the finance tab gets one in the bar instead).
    var showsAdd = false
    @State private var adding = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !state.allowed {
                    SkEmptyState(CL("c.expenses.not_allowed.title"), message: CL("c.expenses.not_allowed.message"))
                } else {
                    totalCard
                    if let error = state.error {
                        SkEmptyState(CL("c.expenses.title"), message: error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                    } else if state.loading && state.rows.isEmpty {
                        SkLoadingIndicator(CL("c.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                    } else if state.rows.isEmpty {
                        SkEmptyState(CL("c.expenses.empty.title"), message: CL("c.expenses.empty.message"))
                    }
                    VStack(spacing: 3) {
                        ForEach(Array(state.rows.enumerated()), id: \.element.id) { index, row in
                            ExpenseRowView(row: row)
                                .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: state.rows.count), style: .continuous))
                        }
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.expenses.title"))
        .refreshable { holder.refresh() }
        .toolbar {
            if showsAdd && state.canAdd {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Label { Text("v7.action.add_expense") } icon: { V7Icon.image("wallet") } }
                }
            }
        }
        .sheet(isPresented: $adding) { ExpenseSheet(holder: holder, state: state) }
    }

    private var totalCard: some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 4) {
            Text(ClinicalFormat.month().uppercased()).font(.system(size: 12, weight: .bold)).tracking(0.7).foregroundStyle(r.onTertiaryContainer.color.opacity(0.8))
            Text(ClinicFormat.rupees(paise: state.totalPaise)).font(.system(size: 34, weight: .heavy)).monospacedDigit()
                .foregroundStyle(r.onTertiaryContainer.color).minimumScaleFactor(0.6).lineLimit(1)
            Text(CLf("c.expenses.entries", state.rows.filter { !$0.void }.count)).font(.system(size: 12.5)).foregroundStyle(r.onTertiaryContainer.color.opacity(0.85))
        }
        .padding(SkSpacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

private struct ExpenseRowView: View {
    let row: ExpenseRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
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
                Text(ClinicFormat.rupees(paise: row.amountPaise)).font(.system(size: 14, weight: .heavy)).monospacedDigit()
                    .foregroundStyle(r.onSurface.color).strikethrough(row.void)
                if row.void { SkChip(CL("c.expenses.void"), tone: .danger) }
            }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .opacity(row.void ? 0.65 : 1)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        [ClinicFormat.date(iso: row.day.isoText), row.note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

extension SpendCategory {
    var label: String { CL(String.LocalizationValue(ClinicalFormat.categoryKey(String(describing: self)))) }

    var iconName: String {
        switch self {
        case .salary: "users"
        case .material: "box"
        case .electricity: "spark"
        case .lab: "flask"
        case .rent: "home"
        case .other: "wallet"
        }
    }
}

extension PayMethod_ {
    var label: String {
        switch self {
        case .upi: CL("c.pay.upi")
        case .cash: CL("c.pay.cash")
        case .card: CL("c.pay.card")
        case .bank: CL("c.pay.bank")
        }
    }
}

extension ExpenseProblem {
    var message: String {
        switch self {
        case .noAmount: CL("c.expenses.problem.amount")
        case .tooLarge: CL("c.expenses.problem.large")
        case .future: CL("c.expenses.problem.future")
        case .noteTooLong: CL("c.expenses.problem.note")
        }
    }
}
