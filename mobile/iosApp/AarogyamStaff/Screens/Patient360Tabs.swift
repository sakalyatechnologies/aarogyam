import AarogyamShared
import SakalyaUI
import SwiftUI

/// Patient 360's tabs, in order. A new tab is one case here and one branch in `PatientTabContent`.
enum PatientTab: CaseIterable, Hashable {
    case overview, chart, rx, billing

    var title: String {
        switch self {
        case .overview: String(localized: "patient.tab.overview", table: "PatientTabs")
        case .chart: String(localized: "patient.tab.chart", table: "PatientTabs")
        case .rx: String(localized: "patient.tab.rx", table: "PatientTabs")
        case .billing: String(localized: "patient.tab.billing", table: "PatientTabs")
        }
    }
}

/// What a tab needs to build its state holder.
struct PatientContext {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
}

/// One tab's content; Overview is drawn by `Patient360Screen` itself.
struct PatientTabContent: View {
    let tab: PatientTab
    let context: PatientContext
    let models: PatientTabModels

    var body: some View {
        switch tab {
        case .overview:
            EmptyView()
        case .chart:
            let model = models.model(.chart, make: { context.graph.chart(clinic: context.clinic, patientId: context.patientId, screen: $0) }, state: { $0.state })
            ChartTab(holder: model.holder, state: model.value)
        case .rx, .billing:
            SkEmptyState(tab.title, message: String(localized: "patient.tab.coming", table: "PatientTabs"))
        }
    }
}

/// Keeps each tab's state holder while Patient 360 is shown, so a tab switch keeps what was loaded.
final class PatientTabModels {
    private var models: [PatientTab: AnyObject] = [:]

    @MainActor
    func model<Holder: AnyObject, Value: AnyObject>(
        _ tab: PatientTab,
        make: (ScreenScope) -> Holder,
        state: (Holder) -> SkieSwiftStateFlow<Value>
    ) -> ScreenModel<Holder, Value> {
        if let existing = models[tab] as? ScreenModel<Holder, Value> { return existing }
        let created = ScreenModel(make: make, state: state)
        models[tab] = created
        return created
    }
}
