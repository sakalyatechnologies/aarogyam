import AarogyamShared
import SakalyaUI
import SwiftUI

/// The month's expenses: a total card, the clinic's recurring expenses (when a holder for them is
/// given), then one row per expense, voided ones struck through.
/// "Add" opens the keypad sheet over the same state holder, so the list gains the new row.
struct ExpensesScreen: View {
    let holder: ExpensesStateHolder
    let state: ExpensesState
    /// Whether this page has its own Add button (the finance tab gets one in the bar instead).
    var showsAdd = false
    var recurring: RecurringExpensesStateHolder?
    var recurringState: RecurringExpensesState?
    @State private var adding = false
    @State private var billOf: String?
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !state.allowed {
                    SkEmptyState(CL("c.expenses.not_allowed.title"), message: CL("c.expenses.not_allowed.message"))
                } else {
                    totalCard
                    if let recurring, let recurringState, recurringState.allowed {
                        RecurringSection(holder: recurring, state: recurringState)
                        RecurringLabel(text: CL("c.recur.this_month")).padding(.top, 6)
                    }
                    if let error = state.error {
                        SkEmptyState(CL("c.expenses.title"), message: error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                    } else if state.loading && state.rows.isEmpty {
                        SkLoadingIndicator(CL("c.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                    } else if state.rows.isEmpty {
                        SkEmptyState(CL("c.expenses.empty.title"), message: CL("c.expenses.empty.message"))
                    }
                    VStack(spacing: 3) {
                        ForEach(Array(state.rows.enumerated()), id: \.element.id) { index, row in
                            // Those who may edit expenses choose to open or remove the bill; others open it.
                            Button { if state.canAdd { billOf = row.id } else { holder.openBill(expenseId: row.id) } } label: {
                                ExpenseRowView(row: row)
                                    .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: state.rows.count), style: .continuous))
                            }
                            .buttonStyle(.skPressable)
                            .disabled(!row.hasBill)
                            .accessibilityHint(row.hasBill ? CL("c.expenses.bill_open") : "")
                        }
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.expenses.title"))
        .refreshable {
            holder.refresh()
            recurring?.refresh()
        }
        .toolbar {
            if showsAdd && state.canAdd {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Label { Text("v7.action.add_expense") } icon: { V7Icon.image("wallet") } }
                }
            }
        }
        .sheet(isPresented: $adding) { ExpenseSheet(holder: holder, state: state) }
        .onChange(of: state.billLink) { _, link in
            // The bill goes to the system (Safari shows photos and PDFs); the link is never kept.
            guard let link else { return }
            if let url = ChatFile.openable(link) { openURL(url) }
            holder.closeBill()
        }
        .alert(state.billRemoveFailed ? CL("c.expenses.bill_remove_failed") : CL("c.expenses.bill_open_failed"),
               isPresented: Binding(get: { state.billLinkFailed || state.billRemoveFailed }, set: { if !$0 { holder.closeBill() } })) {
            Button(CL("c.done"), role: .cancel) { holder.closeBill() }
        }
        .confirmationDialog(CL("c.expenses.photo"), isPresented: Binding(get: { billOf != nil }, set: { if !$0 { billOf = nil } }),
                            titleVisibility: .visible, presenting: billOf) { id in
            Button(CL("c.expenses.bill_open")) { holder.openBill(expenseId: id) }
            Button(CL("c.expenses.photo_remove"), role: .destructive) { holder.removeBill(expenseId: id) }
            Button(CL("c.expenses.cancel"), role: .cancel) {}
        }
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
                if row.recurring { SkChip(CL("c.recur.tag"), tone: .brand) }
                if row.hasBill { SkChip(CL("c.expenses.bill_open"), tone: .neutral) }
            }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .opacity(row.void ? 0.65 : 1)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        [ClinicFormat.date(iso: row.day.isoText), row.method?.label, row.note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
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
