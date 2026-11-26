import AarogyamShared
import SakalyaUI
import SwiftUI

/// The 32-tooth chart card (Overview and the open visit): adult or child, findings or health.
struct V9JawCard: View {
    let holder: ChartStateHolder?
    let state: ChartState?
    let pick: (Int32) -> Void
    let pickAndDictate: (Int32) -> Void
    /// The jaw shows each tooth's health instead of its findings.
    @State private var healthView = false

    var body: some View {
        V7Card {
            VStack(alignment: .leading, spacing: 10) {
                if let state, case .loaded(let loadedChart) = onEnum(of: state) {
                    SkSegmented(Dentition.allCases.map(\.label), selectedIndex: Dentition.allCases.firstIndex(of: loadedChart.dentition) ?? 0) {
                        holder?.showDentition(dentition: Dentition.allCases[$0])
                    }
                    .accessibilityLabel(chartText("chart.title"))
                    let teeth = Dictionary(uniqueKeysWithValues: (loadedChart.upper + loadedChart.lower).map { ($0.number, $0) })
                    let lens = [pv("pv.jaw.view_findings"), pv("pv.tooth.health")]
                    SkChoiceChips(lens, selected: [lens[healthView ? 1 : 0]], label: { $0 }) { healthView = $0 == lens[1] }
                    if UIAccessibility.isVoiceOverRunning {
                        JawList(upper: loadedChart.upper, lower: loadedChart.lower, picked: [], onSelect: { pick($0) }, onLongSelect: { pickAndDictate($0) })
                    } else if healthView {
                        JawChart(dentition: loadedChart.dentition, teeth: teeth, picked: [], onSelect: pick, onLongSelect: pickAndDictate,
                                 tone: { loadedChart.healthMark(tooth: $0).tone }, label: { loadedChart.healthMark(tooth: $0).label },
                                 glyph: { loadedChart.healthMark(tooth: $0).glyph }, outlined: { loadedChart.healthMark(tooth: $0) == .notAssessed })
                    } else {
                        JawChart(dentition: loadedChart.dentition, teeth: teeth, picked: [], onSelect: pick, onLongSelect: pickAndDictate)
                    }
                    if healthView {
                        JawLegend(entries: HealthMark.allCases.map { ($0.tone, [$0.glyph, $0.label].compactMap { $0 }.joined(separator: " ")) })
                    } else {
                        JawLegend()
                    }
                } else if let state, case .failed(let failed) = onEnum(of: state) {
                    V9SectionState(title: chartText("chart.title"), kind: .failed(failed.error), retry: { holder?.refresh() })
                } else if let state, case .notAllowed = onEnum(of: state) {
                    V9SectionState(title: chartText("chart.title"), kind: .notAllowed)
                } else {
                    V9SectionState(title: chartText("chart.title"), kind: .loading)
                }
            }
        }
    }
}
