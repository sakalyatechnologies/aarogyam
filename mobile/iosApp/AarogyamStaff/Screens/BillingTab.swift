import AarogyamShared
import SakalyaUI
import SwiftUI

/// Amount, method and reference for one payment; the state holder keeps the idempotency key.
struct PaymentSheet: View {
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
