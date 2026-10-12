import AarogyamShared
import SakalyaUI
import SwiftUI

/// Visit kinds on a radar with their counts beside it (the "treatment mix" until procedure
/// categories have a server, which has its own Preview card).
struct MixCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let top = ClinicalFormat.radar(view.visitKinds.map { (key: $0.key, value: $0.value) })
        ChartCard(title: CL("c.analytics.mix"), sub: CL("c.analytics.mix.sub")) {
            if let top {
                let total = max(top.reduce(0) { $0 + $1.value }, 1)
                ViewThatFits(in: .horizontal) {
                    row(top, total: total, radar: 130)
                    row(top, total: total, radar: 100)
                }
            } else {
                Text("c.analytics.no_data", tableName: "ClinicalV7").font(.system(size: 13)).foregroundStyle(theme.roles.onSurfaceVariant.color)
            }
        }
    }

    private func row(_ top: [(key: String, value: Int64)], total: Int64, radar: CGFloat) -> some View {
        let r = theme.roles
        return HStack(spacing: 12) {
            SkRadarChart(values: top.map { Double($0.value) }, description: CLf("c.analytics.mix.a11y", top.count))
                .frame(width: radar, height: radar)
            VStack(spacing: 5) {
                ForEach(Array(top.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 6) {
                        Text(ClinicalFormat.keyText(item.key)).font(.system(size: 12.5)).foregroundStyle(r.onSurface.color).lineLimit(2)
                        Spacer(minLength: 4)
                        Text("\(item.value * 100 / total)%").font(.system(size: 12.5, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                    }
                }
            }
        }
    }
}

/// When patients come: weekday rows, clinic-hour columns, busier cells darker.
struct HeatCard: View {
    let view: AnalyticsView
    @State private var picked: (row: Int, column: Int)?

    var body: some View {
        let heat = ClinicalFormat.heat(view.busyHours.map { (weekday: Int($0.weekday), hour: Int($0.hour), visits: Int($0.visits)) })
        let days = ClinicalFormat.weekdayRows()
        ChartCard(title: CL("c.analytics.heat"), sub: CL("c.analytics.heat.sub")) {
            if view.busyHours.isEmpty {
                Text("c.analytics.no_data", tableName: "ClinicalV7").font(.system(size: 13))
            } else {
                SkHeatmap(
                    rowLabels: days, columnLabels: heat.hours.map { hour in hour % 2 == 0 ? "\(hour)" : "" }, loads: heat.loads, selected: picked,
                    onSelect: { picked = (row: $0, column: $1) },
                    describe: { row, column in
                        let visits = view.busyHours.filter { Int($0.weekday) == row + 1 && Int($0.hour) == heat.hours[column] }.map { Int($0.visits) }.reduce(0, +)
                        return CLf("c.analytics.heat.a11y", days[row], heat.hours[column], visits)
                    }
                )
                SkHeatLegend(quiet: CL("c.analytics.heat.quiet"), full: CL("c.analytics.heat.full"))
            }
        }
    }
}

/// Patient visits by age band, as share bars.
struct AgeCard: View {
    let view: AnalyticsView

    var body: some View {
        ChartCard(title: CL("c.analytics.age"), sub: CL("c.analytics.age.sub")) {
            if view.ageBands.isEmpty {
                Text("c.analytics.no_data", tableName: "ClinicalV7").font(.system(size: 13))
            } else {
                ShareRows(rows: view.ageBands.map { (label: $0.key, value: $0.value, text: "\($0.value)") })
            }
        }
    }
}

/// What the clinic spent in the period, by category, with an Add button.
struct SpendCard: View {
    let view: AnalyticsView
    let onAdd: (() -> Void)?

    var body: some View {
        let total = view.expenses?.value ?? 0
        ChartCard(title: CLf("c.analytics.spend", ClinicalFormat.compactRupees(paise: total)), sub: nil) {
            if view.expensesByCategory.isEmpty {
                Text("c.analytics.no_data", tableName: "ClinicalV7").font(.system(size: 13))
            } else {
                ShareRows(
                    rows: view.expensesByCategory.map { (label: CL(String.LocalizationValue(ClinicalFormat.categoryKey($0.key))), value: $0.value, text: ClinicalFormat.compactRupees(paise: $0.value)) },
                    warm: true
                )
            }
            if let onAdd { SkPillButton(CL("c.analytics.add_expense"), variant: .tonal, action: onAdd) }
        }
    }
}

/// Rows of a label, a figure and a bar sized against the biggest (`.erow` / `.ebar`).
struct ShareRows: View {
    let rows: [(label: String, value: Int64, text: String)]
    var warm = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let shares = ClinicalFormat.shares(rows.map(\.value))
        VStack(spacing: 10) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                VStack(spacing: 3) {
                    HStack {
                        Text(ClinicalFormat.keyText(row.label)).font(.system(size: 13)).foregroundStyle(r.onSurface.color).lineLimit(2)
                        Spacer(minLength: 8)
                        Text(row.text).font(.system(size: 13, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(r.surface3.color)
                            Capsule().fill((warm ? r.tertiary : r.primary).color).frame(width: max(geo.size.width * shares[index], 4))
                        }
                    }
                    .frame(height: 8)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
