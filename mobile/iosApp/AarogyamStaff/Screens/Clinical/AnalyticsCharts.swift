import AarogyamShared
import SakalyaUI
import SwiftUI

/// Visit kinds on a radar with their counts beside it.
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
                CardNote(CL("c.analytics.no_data"))
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

/// Patient visits by age band, as share bars.
struct AgeCard: View {
    let view: AnalyticsView

    var body: some View {
        ChartCard(title: CL("c.analytics.age"), sub: CL("c.analytics.age.sub")) {
            if view.ageBands.allSatisfy({ $0.value == 0 }) {
                CardNote(CL("c.analytics.no_data"))
            } else {
                ShareRows(rows: view.ageBands.map { (label: $0.key == "unknown" ? $0.key : AnalyticsFormat.ageBand($0.key), value: $0.value, text: "\($0.value)") })
            }
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
