import AarogyamShared
import Charts
import SakalyaUI
import SwiftUI

/// New against returning patient visits per week or month, as two lines over soft areas.
struct PatientsTrendCard: View {
    let view: AnalyticsView
    @State private var picked: Date?
    @Environment(\.skTheme) private var theme

    private struct Dot: Identifiable {
        let id: String
        let date: Date
        let name: String
        let count: Int
        let label: String
    }

    var body: some View {
        let r = theme.roles
        let fresh = a11("a11.patients.new"), back = a11("a11.patients.returning")
        let dots = view.points.flatMap { point -> [Dot] in
            let date = AnalyticsFormat.date(point.start)
            let label = AnalyticsFormat.bucketLabel(point.start, bucket: view.bucket)
            return [
                Dot(id: "n\(label)", date: date, name: fresh, count: Int(point.newPatients), label: label),
                Dot(id: "r\(label)", date: date, name: back, count: Int(point.returningPatients), label: label),
            ]
        }
        ChartCard(title: a11("a11.patients.title"), sub: view.bucket == .week ? a11("a11.per.week") : a11("a11.per.month")) {
            Chart {
                ForEach(dots) { dot in
                    AreaMark(x: .value("Date", dot.date), y: .value("Patients", dot.count), series: .value("Series", dot.name), stacking: .unstacked)
                        .foregroundStyle(by: .value("Series", dot.name))
                        .opacity(0.14)
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Date", dot.date), y: .value("Patients", dot.count), series: .value("Series", dot.name))
                        .foregroundStyle(by: .value("Series", dot.name))
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.monotone)
                    PointMark(x: .value("Date", dot.date), y: .value("Patients", dot.count))
                        .foregroundStyle(by: .value("Series", dot.name))
                        .symbolSize(30)
                        .accessibilityLabel("\(dot.label), \(dot.name)")
                        .accessibilityValue("\(dot.count)")
                }
                if let point = nearest {
                    RuleMark(x: .value("Date", AnalyticsFormat.date(point.start)))
                        .foregroundStyle(r.onSurfaceVariant.color.opacity(0.4))
                        .annotation(position: .top, spacing: 2, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                            Text(a11f("a11.patients.a11y", AnalyticsFormat.bucketLabel(point.start, bucket: view.bucket), Int(point.newPatients), Int(point.returningPatients)))
                                .font(.system(size: 11, weight: .semibold)).padding(6)
                                .background(r.surface3.color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .foregroundStyle(r.onSurface.color)
                        }
                }
            }
            .chartForegroundStyleScale([fresh: r.primary.color, back: r.tertiary.color])
            .chartXSelection(value: $picked)
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(r.surface3.color)
                    AxisValueLabel().font(.system(size: 10))
                }
            }
            .chartXAxis { dateAxis(view: view, color: r.onSurfaceVariant.color) }
            .chartLegend(position: .bottom, alignment: .leading)
            .frame(height: 210)
        }
    }

    /// The bucket nearest the finger.
    private var nearest: AnalyticsPoint? {
        guard let picked else { return nil }
        return view.points.min { abs(AnalyticsFormat.date($0.start).timeIntervalSince(picked)) < abs(AnalyticsFormat.date($1.start).timeIntervalSince(picked)) }
    }
}

/// Booked against walk-in visits as one bar split in two, with the counts under it.
struct SourcesCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let split = view.visitSources
        let booked = a11("a11.sources.booked"), walkIn = a11("a11.sources.walkin")
        ChartCard(title: a11("a11.sources.title"), sub: split.bookedPercent.map { a11f("a11.chairs.row", $0.intValue) }) {
            if split.bookedPercent == nil {
                CardNote(a11("a11.sources.none"))
            } else {
                Chart {
                    BarMark(x: .value("Visits", Double(split.booked)), y: .value("Source", ""))
                        .foregroundStyle(by: .value("Source", booked))
                    BarMark(x: .value("Visits", Double(split.walkIn)), y: .value("Source", ""))
                        .foregroundStyle(by: .value("Source", walkIn))
                }
                .chartForegroundStyleScale([booked: r.primary.color, walkIn: r.tertiary.color])
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartLegend(.hidden)
                .frame(height: 30)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(a11f("a11.sources.a11y", Int(split.booked), Int(split.walkIn)))
                HStack(spacing: 18) {
                    legend(booked, count: split.booked, color: r.primary.color)
                    legend(walkIn, count: split.walkIn, color: r.tertiary.color)
                }
            }
        }
    }

    private func legend(_ name: String, count: Int64, color: Color) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 10, height: 10)
            Text(name).font(.system(size: 13)).foregroundStyle(theme.roles.onSurface.color)
            Text("\(count)").font(.system(size: 13, weight: .heavy)).monospacedDigit().foregroundStyle(theme.roles.onSurface.color)
        }
        .accessibilityHidden(true)
    }
}

/// Patients seen by sex, biggest first.
struct SexCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        ChartCard(title: a11("a11.sex.title")) {
            if view.sex.allSatisfy({ $0.value == 0 }) {
                CardNote(a11("a11.sex.none"))
            } else {
                HBarChart(rows: view.sex.map { HBarRow(label: AnalyticsFormat.sexName($0.key), value: Double($0.value), text: "\($0.value)") }, tint: theme.roles.primary.color)
            }
        }
    }
}

/// How long the lab takes: the average days, and how many orders it covers.
struct LabCard: View {
    let view: AnalyticsView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let lab = view.lab
        ChartCard(title: a11("a11.lab.title")) {
            if let days = lab.averageDays?.doubleValue {
                let text = a11f("a11.lab.average", String(format: "%.1f", days))
                VStack(alignment: .leading, spacing: 2) {
                    Text(text).font(.system(size: 28, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                    Text(a11("a11.lab.average_caption")).font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
                    Text(a11f("a11.lab.orders", Int(lab.orders))).font(.system(size: 12, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(a11f("a11.lab.a11y", String(format: "%.1f", days), Int(lab.orders)))
            } else {
                CardNote(lab.orders > 0 ? a11f("a11.lab.orders", Int(lab.orders)) + ". " + a11("a11.lab.none") : a11("a11.lab.none"))
            }
        }
    }
}
