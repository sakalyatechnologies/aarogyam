import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Chart tab: the tooth chart with its adult/child toggle and legend, and the picked tooth.
struct ChartTab: View {
    let holder: ChartStateHolder
    let state: ChartState
    @State private var scale: CGFloat = 1
    @State private var recording = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                content
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDisabled(scale > 1)
        .refreshable { holder.refresh() }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(chartText("chart.not_allowed.title"), message: chartText("chart.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(chartText("chart.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded(let loaded):
            loadedChart(loaded)
        }
    }

    @ViewBuilder private func loadedChart(_ state: ChartStateLoaded) -> some View {
        let p = theme.palette
        if let error = state.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
        }
        if let error = state.recordError {
            SkCard {
                VStack(alignment: .leading, spacing: SkSpacing.sm) {
                    Text(String(format: chartText("chart.record_failed"), error.message))
                        .skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
                    SkButton(chartText("chart.dismiss"), variant: .secondary, action: holder.dismissRecordError)
                }
            }
        }
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack {
                    Text(chartText("chart.title")).skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text(String(format: chartText("chart.need_care"), Int(state.needsCare), Int(state.total)))
                        .skTextStyle(SkTypeScale.caption).foregroundStyle(p.textMuted.color)
                }
                SkSegmentedControl(Dentition.allCases.map(\.label), selection: dentitionBinding(state))
                ToothChartView(
                    upper: state.upper,
                    lower: state.lower,
                    selected: state.selected?.tooth.number,
                    selectedSurface: state.selected?.surface,
                    scale: $scale
                ) { tooth, surface in holder.select(tooth: tooth, surface: surface) }
                HStack {
                    Text(chartText("chart.zoom_hint")).skTextStyle(SkTypeScale.caption).foregroundStyle(p.textMuted.color)
                    Spacer()
                    if scale > 1 { Button(chartText("chart.reset_zoom")) { scale = 1 }.skTextStyle(SkTypeScale.caption) }
                }
            }
        }
        if let selection = state.selected {
            ToothPanel(selection: selection, canRecord: state.canRecord, saving: state.saving, onSurface: { holder.selectSurface(surface: $0) }) {
                recording = true
            }
            .sheet(isPresented: Binding(get: { recording && state.canRecord }, set: { recording = $0 })) {
                RecordFindingSheet(tooth: selection.tooth, initialSurface: selection.surface) { finding, surface, note in
                    holder.record(finding: finding, surface: surface, note: note)
                    recording = false
                }
            }
        } else {
            Text(chartText("chart.pick_tooth")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
        }
        legend
    }

    private func dentitionBinding(_ state: ChartStateLoaded) -> Binding<Int> {
        Binding(
            get: { Dentition.allCases.firstIndex(of: state.dentition) ?? 0 },
            set: { index in
                scale = 1
                holder.showDentition(dentition: Dentition.allCases[index])
            }
        )
    }

    private var legend: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(chartText("chart.legend")).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), alignment: .leading)], alignment: .leading, spacing: SkSpacing.sm) {
                    ForEach(Finding.allCases, id: \.self) { finding in
                        HStack(spacing: SkSpacing.s) {
                            FindingSwatch(finding: finding)
                            Text(finding.label).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.text.color)
                        }
                    }
                }
            }
        }
    }
}

/// Copy from the chart's String Catalog (Chart.xcstrings).
func chartText(_ key: String.LocalizationValue) -> String { String(localized: key, table: "Chart") }
