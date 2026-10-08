import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Issued prescriptions from every clinic, each with its verified copy.
struct PrescriptionsScreen: View {
    let graph: PatientGraph

    var body: some View {
        ScreenHost(make: { graph.prescriptions(screen: $0) }, state: { $0.state }) { holder, state in
            ListContent(state: state, retry: holder.refresh, empty: "prescriptions.empty") { (items: [PrescriptionView]) in
                ForEach(items, id: \.id) { PrescriptionCard(rx: $0) }
            }
        }
        .navigationTitle(String(localized: "prescriptions.title"))
    }
}

/// Bills from every clinic and what is still due; read only, the patient pays at the clinic.
struct BillsScreen: View {
    let graph: PatientGraph

    var body: some View {
        ScreenHost(make: { graph.bills(screen: $0) }, state: { $0.state }) { holder, state in
            ListContent(state: state, retry: holder.refresh, empty: nil) { (items: [BillsView]) in
                if let view = items.first {
                    SkHeroCard(
                        kicker: String(localized: "bills.total_due"),
                        title: view.balancePaise > 0 ? ClinicFormat.rupees(paise: view.balancePaise) : String(localized: "bills.all_paid"),
                        subtitle: ""
                    )
                    if view.bills.isEmpty { EmptyCard(key: "bills.empty") }
                    ForEach(view.bills, id: \.id) { BillCard(bill: $0) }
                }
            }
        }
        .navigationTitle(String(localized: "bills.title"))
    }
}

/// A read-only list state: Kotlin's generic `ListState` reaches Swift with its items erased.
private struct ListContent<Item, Rows: View>: View {
    let state: ListState
    let retry: () -> Void
    let empty: String.LocalizationValue?
    @ViewBuilder let rows: ([Item]) -> Rows

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                switch onEnum(of: state) {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .failed(let failed):
                    SkEmptyState(failed.error.message, message: "", actionTitle: String(localized: "try_again"), action: retry)
                case .loaded(let loaded):
                    let items = loaded.items.compactMap { $0 as? Item }
                    if items.isEmpty, let empty { EmptyCard(key: empty) }
                    rows(items)
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { retry() }
    }
}

private struct EmptyCard: View {
    let key: String.LocalizationValue
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkCard { Text(String(localized: key)).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.textMuted.color) }
    }
}

private struct PrescriptionCard: View {
    let rx: PrescriptionView
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(rx.issuedAt?.dateText ?? "").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                Text("\(rx.doctorName ?? rx.number) · \(rx.clinicName)").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                SkDivider()
                ForEach(Array(rx.medicines.enumerated()), id: \.offset) { _, medicine in
                    VStack(alignment: .leading, spacing: 2) {
                        Text([medicine.name, medicine.strength].compactMap { $0 }.joined(separator: " "))
                            .skTextStyle(SkTypeScale.label).foregroundStyle(p.text.color)
                        Text(details(medicine)).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                    }
                }
                if let advice = rx.advice { Text(advice).skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color) }
                if let url = rx.verifyUrl.flatMap(URL.init(string:)) {
                    SkButton(String(localized: "prescriptions.verify"), variant: .secondary) { openURL(url) }
                }
            }
        }
    }

    private func details(_ medicine: MedicineView) -> String {
        var parts = [medicine.dose, medicine.frequency]
        if let timing = medicine.timing { parts.append(Timing.text(timing)) }
        if let days = medicine.days { parts.append(String(format: String(localized: "prescriptions.days"), days.intValue)) }
        return parts.joined(separator: " · ")
    }
}

private struct BillCard: View {
    let bill: BillView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack {
                    Text(bill.issuedAt?.dateText ?? "").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                    Spacer()
                    Text(bill.balancePaise > 0 ? String(format: String(localized: "bills.bill_due"), ClinicFormat.rupees(paise: bill.balancePaise)) : String(localized: "bills.paid"))
                        .skTextStyle(SkTypeScale.label)
                        .foregroundStyle(bill.balancePaise > 0 ? p.primaryText.color : p.textMuted.color)
                }
                Text("\(bill.clinicName) · \(bill.number)").skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                SkDivider()
                ForEach(Array(bill.lines.enumerated()), id: \.offset) { _, line in
                    HStack {
                        Text(line.quantity > 1 ? "\(line.label) × \(line.quantity)" : line.label).foregroundStyle(p.text.color)
                        Spacer()
                        Text(ClinicFormat.rupees(paise: line.totalPaise)).foregroundStyle(p.text.color)
                    }
                    .skTextStyle(SkTypeScale.body)
                }
            }
        }
    }
}
