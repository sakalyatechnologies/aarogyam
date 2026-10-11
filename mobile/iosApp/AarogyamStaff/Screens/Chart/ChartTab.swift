import AarogyamShared
import SakalyaUI
import SwiftUI

/// Copy from the chart's String Catalog (Chart.xcstrings).
func chartText(_ key: String.LocalizationValue) -> String { String(localized: key, table: "Chart") }

/// The Chart tab in the v7 design: the 2.5D jaw (or its list) with the Adult and Child toggle and the
/// legend. A tap on a tooth opens its sheet; "Select several" gathers teeth for one treatment.
struct ChartTab: View {
    let holder: ChartStateHolder
    let state: ChartState
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var sheetOpen = false
    @State private var asList = false
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    var body: some View {
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(chartText("chart.not_allowed.title"), message: chartText("chart.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(chartText("chart.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded(let loaded):
            chart(loaded)
        }
    }

    @ViewBuilder private func chart(_ loaded: ChartStateLoaded) -> some View {
        let r = theme.roles
        if let error = loaded.error ?? loaded.recordError {
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    Text(String(format: chartText("chart.record_failed"), error.message)).v7Text(12.5).foregroundStyle(r.error.color)
                    if loaded.recordError != nil { SkPillButton(chartText("chart.dismiss"), variant: .tonal, action: holder.dismissRecordError) }
                }
            }
        }
        V7Card {
            VStack(alignment: .leading, spacing: 10) {
                SkSegmented(Dentition.allCases.map(\.label), selectedIndex: Dentition.allCases.firstIndex(of: loaded.dentition) ?? 0) {
                    holder.showDentition(dentition: Dentition.allCases[$0])
                }
                .accessibilityLabel(chartText("chart.title"))
                V7ChipRow {
                    SkChoiceChip(chartText("chart.several"), selected: loaded.several) { holder.setSeveral(on: !loaded.several) }
                    SkChoiceChip(pv("pv.jaw.list"), selected: asList || voiceOver) { asList.toggle() }
                }
                let picked = Set(loaded.several ? loaded.group.map(\.int32Value) : loaded.selected.map { [$0.tooth.number] } ?? [])
                if asList || voiceOver {
                    JawList(upper: loaded.upper, lower: loaded.lower, picked: picked) { choose($0, loaded) }
                } else {
                    JawChart(dentition: loaded.dentition, teeth: Dictionary(uniqueKeysWithValues: (loaded.upper + loaded.lower).map { ($0.number, $0) }), picked: picked) { choose($0, loaded) }
                }
                JawLegend()
                if loaded.several && !loaded.group.isEmpty {
                    SkPillButton(pvf("pv.jaw.treat_group", loaded.group.count), variant: .tonal, wide: true) { sheetOpen = true }
                }
            }
        }
        #if DEBUG && AARO_ENV_Local
        .onAppear { devOpen(loaded) }
        #endif
        .sheet(isPresented: Binding(get: { sheetOpen && loaded.selected != nil }, set: { open in
            sheetOpen = open
            if !open { loaded.several ? () : holder.clearSelection() }
        })) {
            if let selection = loaded.selected { ToothSheet(holder: holder, chart: loaded, selection: selection, graph: graph, clinic: clinic) }
        }
    }

    #if DEBUG && AARO_ENV_Local
    private func devOpen(_ loaded: ChartStateLoaded) {
        if let tooth = DevLaunch.tooth, loaded.selected == nil { choose(tooth, loaded) }
    }
    #endif

    private func choose(_ number: Int32, _ loaded: ChartStateLoaded) {
        holder.select(tooth: number, surface: nil)
        if !loaded.several { sheetOpen = true }
    }
}
