import AarogyamShared
import SakalyaUI
import SwiftUI

extension TxStatus {
    var title: String {
        switch self {
        case .done: p9("p9.status.done")
        case .inProgress: p9("p9.status.in_progress")
        case .planned: p9("p9.status.planned")
        case .watch: p9("p9.status.watch")
        }
    }

    var kind: V7Pill.Kind {
        switch self {
        case .done: .done
        case .inProgress, .watch: .warm
        case .planned: .neutral
        }
    }
}

/// The Overview tab: the jaw, health alerts, follow-ups and the X-ray and photo tiles.
struct V9OverviewTab: View {
    let holder: PatientOverviewStateHolder
    let state: OverviewState
    let chart: ScreenModel<ChartStateHolder, ChartState>?
    /// Open follow-ups (`GET /recalls`, filtered to this patient); nil hides the card.
    var followUps: ScreenModel<RecallsStateHolder, RecallsState>?
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var sheetOpen = false
    /// A long press on this tooth: its sheet opens with the note being dictated (the tap that ends the press opens it too).
    @State private var dictating: Int32?
    @Environment(\.skTheme) private var theme

    var body: some View {
        switch onEnum(of: state) {
        case .loading: V9SectionState(title: p9("p9.tab.overview"), kind: .loading)
        case .notAllowed: V9SectionState(title: p9("p9.tab.overview"), kind: .notAllowed)
        case .failed(let failed): V9SectionState(title: p9("p9.tab.overview"), kind: .failed(failed.error), retry: holder.refresh)
        case .loaded(let loaded): content(loaded)
        }
    }

    @ViewBuilder private func content(_ loaded: OverviewStateLoaded) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = loaded.error { V9ErrorLine(error: error) }
            jawCard
            alertsCard(loaded.alerts)
            if let followUps {
                V9FollowUpsCard(holder: followUps.holder, state: followUps.value, canDismiss: clinic.permissions.contains("patients.write"))
                    .id("p9.followups")
            }
            mediaCard(loaded.media)
        }
        .sheet(isPresented: Binding(get: { sheetOpen && selected != nil }, set: { open in
            sheetOpen = open
            if !open { chart?.holder.clearSelection(); holder.refresh(); dictating = nil }
        })) {
            if let chart, let loadedChart, let selection = loadedChart.selected {
                ToothSheet(holder: chart.holder, chart: loadedChart, selection: selection, graph: graph, clinic: clinic,
                          dictate: dictating == selection.tooth.number)
            }
        }
        #if DEBUG && AARO_ENV_Local
        .onChange(of: loadedChart != nil) { _, ready in
            if ready, let tooth = DevLaunch.tooth, selected == nil { pick(tooth) }
        }
        #endif
    }

    // MARK: Jaw

    private var loadedChart: ChartStateLoaded? {
        if let chart, case .loaded(let loaded) = onEnum(of: chart.value) { loaded } else { nil }
    }

    private var selected: ToothSelection? { loadedChart?.selected }

    private func pick(_ tooth: Int32) {
        guard let chart else { return }
        if dictating != tooth { dictating = nil }
        chart.holder.select(tooth: tooth, surface: nil)
        sheetOpen = true
    }

    private func pickAndDictate(_ tooth: Int32) {
        dictating = tooth
        pick(tooth)
    }

    @ViewBuilder private var jawCard: some View {
        V9JawCard(holder: chart?.holder, state: chart?.value, pick: pick, pickAndDictate: pickAndDictate)
    }

    // MARK: Cards

    @ViewBuilder private func alertsCard(_ alerts: FlagsView) -> some View {
        let flags = alertTexts(alerts)
        if !flags.isEmpty {
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    V9SectionHead(title: p9("p9.alerts"), note: p9("p9.alerts.note"))
                    V7Flow(spacing: 6) {
                        ForEach(flags, id: \.0) { _, text, severe in
                            V7Pill(text: text, kind: severe ? .error : .warm)
                        }
                    }
                }
            }
        }
    }

    private func alertTexts(_ alerts: FlagsView) -> [(String, String, Bool)] {
        if alerts.detailsHidden {
            var out: [(String, String, Bool)] = []
            if alerts.allergyCount > 0 { out.append(("a", pvf("pv.flag.allergies", Int(alerts.allergyCount)), alerts.severeAllergy)) }
            if alerts.conditionCount > 0 { out.append(("c", pvf("pv.flag.conditions", Int(alerts.conditionCount)), false)) }
            return out
        }
        return alerts.allergies.enumerated().map { ("a\($0.offset)", $0.element.substance, $0.element.severity == .severe) }
            + alerts.conditions.enumerated().map { ("c\($0.offset)", $0.element, false) }
    }

    @ViewBuilder private func mediaCard(_ media: [MediaView]) -> some View {
        if !media.isEmpty {
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    V9SectionHead(title: p9("p9.media"), note: String(media.count))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], spacing: 8) {
                        ForEach(media, id: \.id) { item in MediaTile(item: item) }
                    }
                }
            }
        }
    }
}

/// One X-ray or photo tile: the kind's icon, its label and the date.
struct MediaTile: View {
    let item: MediaView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let title = item.label ?? (item.kind == .xray ? p9("p9.media.xray") : p9("p9.media.photo"))
        let date = item.at.map { ClinicFormat.date(iso: $0.date.isoText) }
        VStack(spacing: 4) {
            V7Icon(name: item.kind == .xray ? "tooth" : "cam", size: 22, tint: r.primary.color)
            Text(title).v7Text(12, .bold).foregroundStyle(r.onSurface.color).multilineTextAlignment(.center)
            if let date { Text(date).v7Text(11).foregroundStyle(r.onSurfaceVariant.color) }
        }
        .padding(8).frame(maxWidth: .infinity, minHeight: 84)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([title, date].compactMap { $0 }.joined(separator: ", "))
    }
}
