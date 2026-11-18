import AarogyamShared
import Charts
import SakalyaUI
import SwiftUI

/// Revenue and expenses side by side per period, with the net as a line over them; the switch above
/// shows one series alone (as the portal's tiles do).
struct MoneyChartCard: View {
    let view: AnalyticsView
    @State private var series: MoneySeries = .all
    @Environment(\.skTheme) private var theme

    private struct Bar: Identifiable {
        let id: String
        let date: Date
        let kind: String
        let rupees: Double
        let label: String
        let text: String
    }

    var body: some View {
        let r = theme.roles
        let revenue = a11("a11.kpi.revenue"), expenses = a11("a11.kpi.expenses"), net = a11("a11.kpi.net")
        let unit = AnalyticsFormat.unit(view.bucket)
        let bars = view.points.flatMap { point -> [Bar] in
            let date = AnalyticsFormat.date(point.start)
            let label = AnalyticsFormat.bucketLabel(point.start, bucket: view.bucket)
            let income = point.incomePaise?.int64Value ?? 0, spent = point.expensesPaise?.int64Value ?? 0
            var shown: [Bar] = []
            if series == .all || series == .income {
                shown.append(Bar(id: "r\(label)", date: date, kind: revenue, rupees: Double(income) / 100, label: label, text: AnalyticsFormat.rupees(paise: income)))
            }
            if series == .all || series == .expenses {
                shown.append(Bar(id: "e\(label)", date: date, kind: expenses, rupees: Double(spent) / 100, label: label, text: AnalyticsFormat.rupees(paise: spent)))
            }
            return shown
        }
        let names: [MoneySeries: String] = [.all: a11("a11.series.all"), .income: revenue, .expenses: expenses, .net: net]
        let showsNet = series == .all || series == .net
        let netTotal = AnalyticsFormat.rupees(paise: view.netPaise?.int64Value ?? 0)
        ChartCard(title: series == .all ? a11("a11.money.title") : names[series] ?? "", sub: AnalyticsFormat.perBucket(view.bucket)) {
            SkChoiceChips(Array(MoneySeries.allCases), selected: [series], label: { names[$0] ?? "" }) { series = $0 }
            Chart {
                ForEach(bars) { bar in
                    BarMark(x: .value("Date", bar.date, unit: unit), y: .value("Rupees", bar.rupees))
                        .foregroundStyle(by: .value("Kind", bar.kind))
                        .position(by: .value("Kind", bar.kind))
                        .cornerRadius(4)
                        .accessibilityLabel("\(bar.label), \(bar.kind)")
                        .accessibilityValue(bar.text)
                }
                ForEach(Array((showsNet ? view.points : []).enumerated()), id: \.offset) { _, point in
                    let label = AnalyticsFormat.bucketLabel(point.start, bucket: view.bucket)
                    LineMark(x: .value("Date", AnalyticsFormat.date(point.start), unit: unit), y: .value("Rupees", Double(point.netPaise?.int64Value ?? 0) / 100), series: .value("Series", net))
                        .foregroundStyle(by: .value("Kind", net))
                        .interpolationMethod(.monotone)
                        .symbol(.circle)
                        .accessibilityLabel("\(label), \(net)")
                        .accessibilityValue(AnalyticsFormat.rupees(paise: point.netPaise?.int64Value ?? 0))
                }
            }
            .chartForegroundStyleScale([revenue: r.primary.color, expenses: r.tertiary.color, net: r.onSurface.color])
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine().foregroundStyle(r.surface3.color)
                    AxisValueLabel { if let rupees = value.as(Double.self) { Text(AnalyticsFormat.rupees(paise: Int64(rupees * 100))).font(.system(size: 10)) } }
                }
            }
            .chartXAxis { dateAxis(view: view, color: r.onSurfaceVariant.color) }
            .chartLegend(position: .bottom, alignment: .leading)
            .frame(height: 220)
            .accessibilityLabel(a11f("a11.money.chart_a11y", AnalyticsFormat.caption(view.range), netTotal))
            Text(a11f("a11.money.net_total", netTotal)).font(.system(size: 13, weight: .heavy)).foregroundStyle(r.onSurface.color)
        }
    }
}

/// X axis marks for day, week or month buckets.
@AxisContentBuilder
func dateAxis(view: AnalyticsView, color: Color) -> some AxisContent {
    AxisMarks(values: .automatic(desiredCount: 5)) { _ in
        AxisGridLine().foregroundStyle(Color.clear)
        AxisValueLabel(format: AnalyticsFormat.axisFormat(view), centered: false)
            .font(.system(size: 10)).foregroundStyle(color)
    }
}

/// What was spent by category, biggest first, with the amount on each bar and the Add expense button.
struct ExpenseCategoryCard: View {
    let view: AnalyticsView
    let onAdd: (() -> Void)?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let total = view.expenses?.value ?? 0
        ChartCard(title: a11("a11.cat.title"), sub: a11f("a11.cat.total", AnalyticsFormat.rupees(paise: total))) {
            if view.expensesByCategory.isEmpty {
                CardNote(a11("a11.cat.none"))
            } else {
                HBarChart(
                    rows: view.expensesByCategory.map { HBarRow(label: CL(String.LocalizationValue(ClinicalFormat.categoryKey($0.key))), value: Double($0.value), text: AnalyticsFormat.rupees(paise: $0.value)) },
                    tint: theme.roles.tertiary.color
                )
            }
            if let onAdd { SkPillButton(a11("a11.cat.add"), variant: .tonal, wide: true, action: onAdd) }
        }
    }
}

struct HBarRow: Identifiable {
    var id: String { label }
    let label: String
    let value: Double
    let text: String
}

/// Horizontal bars, one per row, with the figure after each bar; labels double as the VoiceOver text.
struct HBarChart: View {
    let rows: [HBarRow]
    let tint: Color
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let peak = max(rows.map(\.value).max() ?? 1, 1)
        Chart(rows) { row in
            BarMark(x: .value("Amount", row.value), y: .value("Name", row.label))
                .foregroundStyle(tint)
                .cornerRadius(5)
                .annotation(position: .trailing, alignment: .leading) {
                    Text(row.text).font(.system(size: 12, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                }
                .accessibilityLabel(row.label)
                .accessibilityValue(row.text)
        }
        .chartXScale(domain: 0...(peak * 1.5))
        .chartXAxis(.hidden)
        .chartYAxis { AxisMarks { _ in AxisValueLabel().font(.system(size: 12.5)).foregroundStyle(r.onSurface.color) } }
        .frame(height: CGFloat(rows.count) * 36 + 6)
    }
}
