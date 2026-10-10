import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Bills tab: the mockup's bill lines with a status pill, a real payment sheet, and Collect by UPI as a Preview.
struct PatientBillsTab: View {
    let holder: BillingStateHolder
    let state: BillingState
    let onUpi: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Group {
            switch onEnum(of: state) {
            case .loading, .hidden:
                SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xl)
            case .failed(let failed):
                SkEmptyState(pv("pv.tab.bills"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
            case .loaded(let loaded):
                content(loaded, r)
            }
        }
        .sheet(isPresented: Binding(get: { loaded?.form != nil }, set: { if !$0 { holder.cancelPayment() } })) {
            if let form = loaded?.form { PaymentSheet(holder: holder, form: form) }
        }
    }

    private var loaded: BillingStateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    @ViewBuilder private func content(_ state: BillingStateLoaded, _ r: SkRoles) -> some View {
        if let error = state.error { Text(error.message).v7Text(12.5).foregroundStyle(r.error.color) }
        if let receipt = state.receipt { V7Pill(text: pvf("pv.bills.recorded", receipt), kind: .done) }
        if state.view.bills.isEmpty { V7Card { V7Muted(String(localized: "billing.none")).frame(maxWidth: .infinity) } }
        VStack(spacing: 6) {
            ForEach(state.view.bills, id: \.id) { bill in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(ClinicFormat.rupees(paise: bill.totalPaise)).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                        Text(bill.titleText + " · " + (bill.issuedOn.map { ClinicFormat.date(iso: $0.isoText) } ?? "")).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        if bill.balancePaise > 0 {
                            Text(pvf("pv.bills.due", ClinicFormat.rupees(paise: bill.balancePaise))).v7Text(12, .semibold).foregroundStyle(r.error.color)
                        }
                    }
                    Spacer(minLength: 4)
                    VStack(alignment: .trailing, spacing: 6) {
                        V7Pill(text: bill.status.label, kind: bill.status == .paid ? .done : .warm)
                        if bill.canRecordPayment {
                            Button { holder.startPayment(billId: bill.id) } label: {
                                Text(pv("pv.bills.record")).v7Text(12, .bold).foregroundStyle(r.primary.color).frame(minHeight: 32)
                            }
                        }
                    }
                }
                .padding(.vertical, 11).padding(.horizontal, 12)
                .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityElement(children: .contain)
            }
        }
        if state.view.balancePaise > 0 && state.canRecord {
            SkPillButton(pvf("pv.bills.collect", ClinicFormat.rupees(paise: state.view.balancePaise)), variant: .warm, wide: true, action: onUpi)
        }
    }
}

/// Amount, method and reference for one payment; the state holder keeps the idempotency key.
private struct PaymentSheet: View {
    let holder: BillingStateHolder
    let form: PaymentForm
    @State private var amount: String
    @State private var reference: String
    @Environment(\.skTheme) private var theme

    init(holder: BillingStateHolder, form: PaymentForm) {
        self.holder = holder
        self.form = form
        _amount = State(initialValue: form.amountText)
        _reference = State(initialValue: form.reference)
    }

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(String(localized: "billing.record"), subtitle: String(format: String(localized: "billing.balance"), ClinicFormat.rupees(paise: form.balancePaise)))
                SkField(String(localized: "billing.amount"), text: $amount, error: form.amountInvalid ? String(localized: "billing.amount.invalid") : nil, keyboard: .decimalPad)
                V7Label(text: pv("pv.bills.method"))
                SkChoiceChips(Array(PayMethod.allCases), selected: [form.method], label: { $0.label }) { holder.setMethod(method: $0) }
                SkField(String(localized: "billing.reference"), text: $reference)
                if let error = form.error { Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                SkPillButton(String(localized: "billing.record"), wide: true, loading: form.submitting) { holder.submitPayment() }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        .onChange(of: amount) { _, text in holder.setAmount(text: text) }
        .onChange(of: reference) { _, text in holder.setReference(text: text) }
    }
}
