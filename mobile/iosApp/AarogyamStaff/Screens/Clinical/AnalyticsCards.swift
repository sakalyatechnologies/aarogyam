import AarogyamShared
import SakalyaUI
import SwiftUI

/// All the cards of one range, top to bottom: numbers, money, patients, chairs, then the mix.
struct AnalyticsCards: View {
    let view: AnalyticsView
    let onAddExpense: (() -> Void)?

    var body: some View {
        KpiGrid(view: view)
        if view.revenue != nil {
            MoneyChartCard(view: view)
            ExpenseCategoryCard(view: view, onAdd: onAddExpense)
        }
        PatientsTrendCard(view: view)
        ChairsCard(view: view)
        ChairTimeCard(view: view)
        HeatCard(view: view)
        SourcesCard(view: view)
        ProceduresCard(view: view)
        MixCard(view: view)
        AgeCard(view: view)
        SexCard(view: view)
        LabCard(view: view)
    }
}

/// A rounded card with a heading and a quiet sub-line (`.chartc`).
struct ChartCard<Content: View>: View {
    let title: String
    var sub: String?
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.ml) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.system(size: 16, weight: .heavy)).foregroundStyle(r.onSurface.color)
                Spacer(minLength: 0)
                if let sub { Text(sub).font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color) }
            }
            .accessibilityAddTraits(.isHeader)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

/// One quiet line inside a card, for a range that has none of that data.
struct CardNote: View {
    let text: String
    @Environment(\.skTheme) private var theme

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.system(size: 13)).foregroundStyle(theme.roles.onSurfaceVariant.color)
    }
}

private struct KpiGrid: View {
    let view: AnalyticsView

    var body: some View {
        let versus = a11f("a11.vs", Int(view.range.days))
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top), GridItem(.flexible(), spacing: 8, alignment: .top)], spacing: 8) {
            KpiCard(label: a11("a11.kpi.visits"), value: "\(view.patientVisits.value)", delta: view.patientVisits.deltaPercent?.intValue, note: versus)
            KpiCard(label: a11("a11.kpi.new"), value: "\(view.newPatients.value)", delta: view.newPatients.deltaPercent?.intValue, note: a11("a11.kpi.new.note"))
            if let revenue = view.revenue, let expenses = view.expenses {
                KpiCard(label: a11("a11.kpi.revenue"), value: AnalyticsFormat.rupees(paise: revenue.value), delta: revenue.deltaPercent?.intValue, note: versus)
                KpiCard(label: a11("a11.kpi.expenses"), value: AnalyticsFormat.rupees(paise: expenses.value), delta: expenses.deltaPercent?.intValue, note: versus, goodWhenDown: true)
                if let net = view.netPaise {
                    KpiCard(label: a11("a11.kpi.net"), value: AnalyticsFormat.rupees(paise: net.int64Value), delta: nil, note: a11("a11.kpi.net.note"))
                }
                if let payments = view.payments {
                    KpiCard(label: a11("a11.kpi.payments"), value: "\(payments.int64Value)", delta: nil, note: a11("a11.kpi.payments.note"))
                }
            }
            KpiCard(
                label: a11("a11.kpi.chair"), value: view.avgChairMinutes.map { a11f("a11.minutes", $0.intValue) } ?? "–",
                delta: nil, note: a11("a11.kpi.chair.note")
            )
            KpiCard(label: a11("a11.kpi.util"), value: "\(Int((Double(view.chairUtilization) * 100).rounded()))%", delta: nil, note: a11("a11.kpi.util.note"))
        }
    }
}

private struct KpiCard: View {
    let label: String
    let value: String
    let delta: Int?
    let note: String
    var goodWhenDown = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let bad = goodWhenDown ? (delta ?? 0) > 0 : (delta ?? 0) < 0
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color)
            Text(value).font(.system(size: 25, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color).minimumScaleFactor(0.6).lineLimit(1)
            if let text = ClinicalFormat.delta(delta) {
                Text(text).font(.system(size: 10.5, weight: .heavy)).padding(.horizontal, 7).padding(.vertical, 3)
                    .foregroundStyle(bad ? r.onErrorContainer.color : r.onPrimaryContainer.color)
                    .background((bad ? r.errorContainer : r.primaryContainer).color, in: Capsule())
            }
            Text(note).font(.system(size: 11, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(a11f("a11.kpi.a11y", label, value, [AnalyticsFormat.deltaSpeech(delta), note].filter { !$0.isEmpty }.joined(separator: ", ")))
    }
}
