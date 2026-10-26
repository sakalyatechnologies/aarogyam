import AarogyamShared
import SakalyaUI
import SwiftUI

/// All the cards of one period, top to bottom.
struct AnalyticsCards: View {
    let view: AnalyticsView
    let onAddExpense: (() -> Void)?
    @State private var selectedBar: Int?

    var body: some View {
        let bars = view.bars
        let selected = selectedBar ?? max(bars.count - 1, 0)
        KpiGrid(view: view)
        ChartCard(title: CL("c.analytics.patients"), sub: CL("c.analytics.tap_bar")) {
            if bars.isEmpty {
                Text("c.analytics.no_data", tableName: "ClinicalV7").font(.system(size: 13))
            } else {
                let monthly = view.period != .week
                let labels = bars.map { ClinicalFormat.barLabel(iso: $0.start.isoText, monthly: monthly, narrow: bars.count > 12) }
                SkBarChart(
                    values: bars.map { Double($0.patientVisits) }, labels: labels, selectedIndex: selected,
                    tooltip: { CLf("c.analytics.tip", Int(bars[$0].patientVisits), Int(bars[$0].newPatients)) },
                    describe: { CLf("c.analytics.bar.a11y", labels[$0], Int(bars[$0].patientVisits)) },
                    onSelect: { selectedBar = $0 }
                )
            }
        }
        ChairCard(view: view)
        PreviewCard(title: CL("c.analytics.chair_split"), sub: CL("c.analytics.chair_split.sub"))
        PreviewCard(title: CL("c.analytics.booked_walkin"), sub: CL("c.analytics.booked_walkin.sub"))
        MixCard(view: view)
        PreviewCard(title: CL("c.analytics.procedures"), sub: CL("c.analytics.procedures.sub"))
        HeatCard(view: view)
        AgeCard(view: view)
        PreviewCard(title: CL("c.analytics.sex"), sub: CL("c.analytics.sex.sub"))
        if view.expenses != nil { SpendCard(view: view, onAdd: onAddExpense) }
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

/// A chart the server cannot fill yet: its title and the Preview marker, no invented numbers.
struct PreviewCard: View {
    let title: String
    let sub: String

    var body: some View {
        ChartCard(title: title, sub: sub) { PreviewNotice() }
    }
}

private struct KpiGrid: View {
    let view: AnalyticsView

    var body: some View {
        let against = view.period.against
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8, alignment: .top), GridItem(.flexible(), spacing: 8, alignment: .top)], spacing: 8) {
            KpiCard(label: CL("c.analytics.kpi.patients"), value: "\(view.patientVisits.value)", delta: view.patientVisits.deltaPercent?.intValue, note: against)
            if let revenue = view.revenue {
                KpiCard(
                    label: CL("c.analytics.kpi.revenue"), value: ClinicalFormat.compactRupees(paise: revenue.value), delta: revenue.deltaPercent?.intValue,
                    note: view.expenses.map { CLf("c.analytics.kpi.expenses", ClinicalFormat.compactRupees(paise: $0.value)) } ?? against
                )
            }
            KpiCard(label: CL("c.analytics.kpi.new"), value: "\(view.newPatients.value)", delta: view.newPatients.deltaPercent?.intValue, note: CL("c.analytics.kpi.new.note"))
            KpiCard(
                label: CL("c.analytics.kpi.chair"),
                value: view.avgChairMinutes.map { CLf("c.analytics.minutes", $0.intValue) } ?? "–",
                delta: nil, note: CL("c.analytics.kpi.chair.note")
            )
        }
    }
}

private struct KpiCard: View {
    let label: String
    let value: String
    let delta: Int?
    let note: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color)
            Text(value).font(.system(size: 25, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color).minimumScaleFactor(0.6).lineLimit(1)
            if let text = ClinicalFormat.delta(delta) {
                Text(text).font(.system(size: 10.5, weight: .heavy)).padding(.horizontal, 7).padding(.vertical, 3)
                    .foregroundStyle((delta ?? 0) < 0 ? r.onErrorContainer.color : r.onPrimaryContainer.color)
                    .background(((delta ?? 0) < 0 ? r.errorContainer : r.primaryContainer).color, in: Capsule())
            }
            Text(note).font(.system(size: 11, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Booked over open chair minutes, as the half-circle gauge.
private struct ChairCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let used = Double(min(max(view.chairUtilization, 0), 1))
        let percent = Int((Double(view.chairUtilization) * 100).rounded())
        ChartCard(title: CL("c.analytics.chair"), sub: CL("c.analytics.chair.sub")) {
            SkGauge(
                values: [used, 1 - used], colors: [theme.roles.primary.color, theme.roles.surface3.color],
                total: "\(percent)%", caption: CL("c.analytics.chair.caption"), description: CLf("c.analytics.chair.a11y", percent)
            )
            .frame(maxWidth: 260).frame(maxWidth: .infinity)
        }
    }
}
