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

/// The Overview tab: the jaw, health alerts, treatments, the last visit and the X-ray and photo tiles.
struct V9OverviewTab: View {
    let holder: PatientOverviewStateHolder
    let state: OverviewState
    let chart: ScreenModel<ChartStateHolder, ChartState>?
    let graph: AppGraph
    let clinic: ClinicContext
    let onOpenVisit: (String) -> Void
    @State private var sheetOpen = false
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
            treatmentsCard(loaded.treatments)
            if let last = loaded.lastVisit { lastVisitCard(last) }
            mediaCard(loaded.media)
        }
        .sheet(isPresented: Binding(get: { sheetOpen && selected != nil }, set: { open in
            sheetOpen = open
            if !open { chart?.holder.clearSelection(); holder.refresh() }
        })) {
            if let chart, let loadedChart, let selection = loadedChart.selected {
                ToothSheet(holder: chart.holder, chart: loadedChart, selection: selection, graph: graph, clinic: clinic)
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
        chart.holder.select(tooth: tooth, surface: nil)
        sheetOpen = true
    }

    @ViewBuilder private var jawCard: some View {
        V7Card {
            VStack(alignment: .leading, spacing: 10) {
                if let loadedChart {
                    SkSegmented(Dentition.allCases.map(\.label), selectedIndex: Dentition.allCases.firstIndex(of: loadedChart.dentition) ?? 0) {
                        chart?.holder.showDentition(dentition: Dentition.allCases[$0])
                    }
                    .accessibilityLabel(chartText("chart.title"))
                    let teeth = Dictionary(uniqueKeysWithValues: (loadedChart.upper + loadedChart.lower).map { ($0.number, $0) })
                    if UIAccessibility.isVoiceOverRunning {
                        JawList(upper: loadedChart.upper, lower: loadedChart.lower, picked: []) { pick($0) }
                    } else {
                        JawChart(dentition: loadedChart.dentition, teeth: teeth, picked: [], onSelect: pick)
                    }
                    JawLegend()
                } else if let chart, case .failed(let failed) = onEnum(of: chart.value) {
                    V9SectionState(title: chartText("chart.title"), kind: .failed(failed.error), retry: chart.holder.refresh)
                } else if let chart, case .notAllowed = onEnum(of: chart.value) {
                    V9SectionState(title: chartText("chart.title"), kind: .notAllowed)
                } else {
                    V9SectionState(title: chartText("chart.title"), kind: .loading)
                }
            }
        }
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

    private func treatmentsCard(_ rows: [TreatmentRow]) -> some View {
        let r = theme.roles
        let teeth = Set(rows.map(\.tooth)).count
        return V7Card {
            VStack(alignment: .leading, spacing: 6) {
                V9SectionHead(title: p9("p9.treatments"), note: rows.isEmpty ? nil : p9f("p9.treatments.count", rows.count, teeth))
                if rows.isEmpty {
                    V7Muted(p9("p9.treatments.none"))
                } else {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        Button { pick(row.tooth) } label: {
                            HStack(spacing: 12) {
                                V9Round(text: String(row.tooth))
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(row.procedure ?? row.finding.label).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                                    Text(ClinicFormat.date(iso: row.date.date.isoText)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                V7Pill(text: row.status.title, kind: row.status.kind)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.skPressable)
                        .disabled(chart == nil)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(p9f("p9.treatment.a11y", Int(row.tooth), row.procedure ?? row.finding.label, row.status.title))
                        .accessibilityHint(p9("p9.treatment.hint"))
                    }
                }
            }
        }
    }

    private func lastVisitCard(_ last: LastVisitView) -> some View {
        let r = theme.roles
        return Button { onOpenVisit(last.id) } label: {
            V7Card {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        V9SectionHead(title: p9("p9.last_visit"), note: nil)
                        Text(ClinicFormat.date(iso: last.at.date.isoText) + " · " + last.clinician)
                            .v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        Text(last.reason ?? last.number).v7Text(14, .semibold).foregroundStyle(r.onSurface.color)
                    }
                    Spacer(minLength: 4)
                    V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
                }
            }
        }
        .buttonStyle(.skPressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(p9f("p9.last_visit.a11y", ClinicFormat.date(iso: last.at.date.isoText), last.clinician, last.reason ?? last.number))
        .accessibilityAddTraits(.isButton)
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
