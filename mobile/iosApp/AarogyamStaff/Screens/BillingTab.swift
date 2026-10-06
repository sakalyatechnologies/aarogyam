import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Billing tab of Patient 360: balance, the patient's bills and, with `billing.write`, payments.
struct BillingTab: View {
    let holder: BillingStateHolder
    let state: BillingState
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                content
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { await refresh() }
        .sheet(isPresented: sheetShown) {
            if let form = loaded?.form {
                PaymentSheet(holder: holder, form: form)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private var loaded: BillingStateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    private var sheetShown: Binding<Bool> {
        Binding(get: { loaded?.form != nil }, set: { if !$0 { holder.cancelPayment() } })
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading, .hidden:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .failed(let failed):
            SkEmptyState(
                String(localized: "billing.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            BillingContent(holder: holder, state: loaded)
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? BillingStateLoaded, now.refreshing { continue }
            break
        }
    }
}

private struct BillingContent: View {
    let holder: BillingStateHolder
    let state: BillingStateLoaded
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        let view = state.view
        if let error = state.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
        }
        if let receipt = state.receipt {
            SkChip(String(format: String(localized: "billing.payment_recorded"), receipt), tone: .success)
        }
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text("patient.balance").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                    .accessibilityAddTraits(.isHeader)
                Text(view.balanceText).skTextStyle(SkTypeScale.headline)
                    .foregroundStyle(view.balancePaise > 0 ? p.dangerText.color : p.textMuted.color)
            }
        }
        if view.bills.isEmpty {
            Text("billing.none").skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
        }
        ForEach(view.bills, id: \.id) { bill in
            SkCard {
                VStack(alignment: .leading, spacing: SkSpacing.sm) {
                    SkListRow(bill.titleText, subtitle: bill.subtitleText) {
                        EmptyView()
                    } trailing: {
                        SkChip(bill.status.label, tone: bill.status.tone)
                    }
                    if bill.balancePaise > 0 {
                        Text(String(format: String(localized: "patient.balance.due"), ClinicFormat.rupees(paise: bill.balancePaise)))
                            .skTextStyle(SkTypeScale.body).foregroundStyle(p.dangerText.color)
                    }
                    if bill.canRecordPayment {
                        SkButton(String(localized: "billing.record")) { holder.startPayment(billId: bill.id) }
                    }
                }
            }
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
        let p = theme.palette
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                Text("billing.record").skTextStyle(SkTypeScale.title).foregroundStyle(p.text.color)
                Text(String(format: String(localized: "billing.balance"), ClinicFormat.rupees(paise: form.balancePaise)))
                    .skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                SkTextField(
                    String(localized: "billing.amount"),
                    text: $amount,
                    message: form.amountInvalid ? String(localized: "billing.amount.invalid") : nil,
                    isError: form.amountInvalid
                )
                .keyboardType(.decimalPad)
                SkSegmentedControl(PayMethod.allCases.map(\.label), selection: methodIndex)
                SkTextField(String(localized: "billing.reference"), text: $reference)
                if let error = form.error {
                    Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
                }
                SkButton(form.submitting ? String(localized: "billing.recording") : String(localized: "billing.record")) {
                    if !form.submitting { holder.submitPayment() }
                }
            }
            .padding(SkSpacing.l)
        }
        .onChange(of: amount) { _, text in holder.setAmount(text: text) }
        .onChange(of: reference) { _, text in holder.setReference(text: text) }
    }

    private var methodIndex: Binding<Int> {
        Binding(
            get: { PayMethod.allCases.firstIndex(of: form.method) ?? 0 },
            set: { holder.setMethod(method: PayMethod.allCases[$0]) }
        )
    }
}
