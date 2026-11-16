import AarogyamShared
import Charts
import SakalyaUI
import SwiftUI

/// One row per chair: booked against open time over the range, with the percent.
struct ChairsCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        ChartCard(title: a11("a11.chairs.title"), sub: a11("a11.chairs.sub")) {
            if view.chairs.isEmpty {
                CardNote(a11("a11.chairs.none"))
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(view.chairs.enumerated()), id: \.offset) { _, chair in ChairRow(chair: chair) }
                }
                HStack(spacing: 18) {
                    key(a11("a11.chairs.booked"), color: theme.roles.primary.color)
                    key(a11("a11.chairs.open"), color: theme.roles.surface3.color)
                }
                .accessibilityHidden(true)
            }
        }
    }

    private func key(_ name: String, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 10, height: 10)
            Text(name).font(.system(size: 12)).foregroundStyle(theme.roles.onSurfaceVariant.color)
        }
    }
}

private struct ChairRow: View {
    let chair: ChairUse
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let percent = Int(chair.percent)
        let booked = Double(min(max(percent, 0), 100))
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(chair.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(r.onSurface.color).lineLimit(1)
                Spacer(minLength: 8)
                Text("\(percent)%").font(.system(size: 13, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
            }
            Chart {
                BarMark(x: .value("Booked", booked), y: .value("Chair", chair.name)).foregroundStyle(r.primary.color)
                BarMark(x: .value("Open", 100 - booked), y: .value("Chair", chair.name)).foregroundStyle(r.surface3.color)
            }
            .chartXScale(domain: 0...100)
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 14)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(a11f("a11.chairs.a11y", chair.name, percent, Int(chair.bookedMinutes), Int(chair.openMinutes)))
    }
}

/// Booked chair minutes split into treatment, consults and admin, as a donut with a key.
struct ChairTimeCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let colors = [r.primary.color, r.tertiary.color, r.primary2.color]
        let names = view.chairTime.map { AnalyticsFormat.sliceName($0.key) }
        ChartCard(title: a11("a11.split.title"), sub: a11("a11.split.sub")) {
            if view.chairTime.isEmpty {
                CardNote(CL("c.analytics.no_data"))
            } else {
                HStack(spacing: 16) {
                    Chart(Array(view.chairTime.enumerated()), id: \.offset) { index, slice in
                        SectorMark(angle: .value("Minutes", Double(slice.minutes)), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .foregroundStyle(colors[index % colors.count])
                            .cornerRadius(4)
                            .accessibilityLabel(names[index])
                            .accessibilityValue(a11f("a11.split.a11y", names[index], Int(slice.percent), Int(slice.minutes)))
                    }
                    .frame(width: 130, height: 130)
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(view.chairTime.enumerated()), id: \.offset) { index, slice in
                            HStack(spacing: 6) {
                                Circle().fill(colors[index % colors.count]).frame(width: 10, height: 10)
                                Text(names[index]).font(.system(size: 13)).foregroundStyle(r.onSurface.color)
                                Spacer(minLength: 4)
                                Text("\(slice.percent)%").font(.system(size: 13, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                            }
                            .accessibilityHidden(true)
                        }
                    }
                }
            }
        }
    }
}

/// Weekday rows by clinic hour; darker is busier. Booked chair minutes, or visits when the server sent no occupancy.
struct HeatCard: View {
    let view: AnalyticsView
    @State private var picked: (row: Int, column: Int)?

    var body: some View {
        let minutes = view.heatUnit == .bookedMinutes
        let heat = ClinicalFormat.heat(view.heat.map { (weekday: Int($0.weekday), hour: Int($0.hour), visits: Int($0.value)) })
        let days = ClinicalFormat.weekdayRows()
        ChartCard(title: minutes ? a11("a11.heat.title") : a11("a11.heat.visits_title"), sub: minutes ? a11("a11.heat.sub") : a11("a11.heat.visits_sub")) {
            if view.heat.isEmpty {
                CardNote(CL("c.analytics.no_data"))
            } else {
                SkHeatmap(
                    rowLabels: days, columnLabels: heat.hours.map { hour in hour % 2 == 0 ? "\(hour)" : "" }, loads: heat.loads, selected: picked,
                    onSelect: { picked = (row: $0, column: $1) },
                    describe: { row, column in
                        let value = view.heat.filter { Int($0.weekday) == row + 1 && Int($0.hour) == heat.hours[column] }.map { Int($0.value) }.reduce(0, +)
                        return a11f(minutes ? "a11.heat.a11y_minutes" : "a11.heat.a11y_visits", days[row], heat.hours[column], value)
                    }
                )
                SkHeatLegend(quiet: CL("c.analytics.heat.quiet"), full: CL("c.analytics.heat.full"))
            }
        }
    }
}

/// Procedures done by category, most often first; the amount joins the count when money is visible.
struct ProceduresCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        ChartCard(title: a11("a11.proc.title"), sub: a11("a11.proc.sub")) {
            if view.procedures.isEmpty {
                CardNote(a11("a11.proc.none"))
            } else {
                HBarChart(
                    rows: view.procedures.map { item in
                        let amount = item.amountPaise?.int64Value
                        return HBarRow(label: ClinicalFormat.keyText(item.key), value: Double(item.count), text: amount.map { "\(item.count) · \(AnalyticsFormat.rupees(paise: $0))" } ?? "\(item.count)")
                    },
                    tint: theme.roles.primary.color
                )
            }
        }
    }
}
