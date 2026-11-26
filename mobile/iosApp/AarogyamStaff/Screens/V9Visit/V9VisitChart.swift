import AarogyamShared
import SakalyaUI
import SwiftUI

/// Start treatment opens on the full chart: tap a tooth for its sheet, the same one the patient page has.
struct V9VisitChart: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let chart: ChartStateHolder
    let state: ChartState
    let visitId: String
    @State private var sheetOpen = false
    @State private var dictating: Int32?

    var body: some View {
        V9JawCard(holder: chart, state: state, pick: pick, pickAndDictate: { dictating = $0; pick($0) })
            .sheet(isPresented: Binding(get: { sheetOpen && selection != nil }, set: { open in
                sheetOpen = open
                if !open { chart.clearSelection(); dictating = nil }
            })) {
                if case .loaded(let loaded) = onEnum(of: state), let selection = loaded.selected {
                    ToothSheet(holder: chart, chart: loaded, selection: selection, graph: graph, clinic: clinic,
                               dictate: dictating == selection.tooth.number, visitId: visitId)
                }
            }
    }

    private var selection: ToothSelection? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded.selected } else { nil }
    }

    private func pick(_ tooth: Int32) {
        chart.select(tooth: tooth, surface: nil)
        sheetOpen = true
    }
}
