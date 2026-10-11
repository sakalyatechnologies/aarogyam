import AarogyamShared
import SakalyaUI
import SwiftUI

/// The tooth sheet: the picked tooth (or the group) with its history and Edit, and Add treatment.
/// Its form lives in the shared `ToothSheetStateHolder`, over the chart's own holder.
struct ToothSheet: View {
    let holder: ChartStateHolder
    let chart: ChartStateLoaded
    let selection: ToothSelection
    let graph: AppGraph
    let clinic: ClinicContext

    var body: some View {
        ScreenHost(make: { graph.toothSheet(clinic: clinic, chart: holder, visitId: nil, screen: $0) }, state: { $0.form }) { sheet, form in
            ToothSheetBody(holder: holder, chart: chart, selection: selection, sheet: sheet, form: form)
        }
    }
}

private struct ToothSheetBody: View {
    let holder: ChartStateHolder
    let chart: ChartStateLoaded
    let selection: ToothSelection
    let sheet: ToothSheetStateHolder
    let form: TreatmentFormState
    @State private var adding = false
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    private var group: [Int32] { chart.several ? chart.group.map(\.int32Value) : [] }
    private var isGroup: Bool { group.count > 1 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                if adding || isGroup {
                    AddTreatmentForm(holder: holder, chart: chart, sheet: sheet, form: form, tooth: selection.tooth, group: group) {
                        if isGroup { dismiss() } else { adding = false; sheet.reset() }
                    }
                } else {
                    nowCard
                    historyCard
                    if chart.canRecord {
                        SkPillButton(pv("pv.tooth.add"), wide: true) { sheet.reset(); adding = true }
                    }
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        #if DEBUG && AARO_ENV_Local
        .onAppear { if DevLaunch.toothForm { adding = true } }
        #endif
        .onChange(of: form.saved) { _, saved in
            if saved { sheet.reset(); adding = false; dismiss() }
        }
    }

    private var header: some View {
        let tooth = selection.tooth
        let r = theme.roles
        return HStack(spacing: 12) {
            if isGroup {
                SkSheetHeader(pvf("pv.tooth.group", group.count), subtitle: group.map(String.init).joined(separator: ", "))
            } else {
                Text(String(tooth.number)).v7Text(11.5, .heavy).foregroundStyle(r.onPrimaryContainer.color)
                    .frame(width: 36, height: 36).background(r.primaryContainer.color, in: Circle()).accessibilityHidden(true)
                SkSheetHeader(pvf("pv.tooth.title", Int(tooth.number)), subtitle: ToothName.text(number: Int(tooth.number), kind: tooth.kind.label))
            }
        }
    }

    /// What is on the tooth now: its drawing and one line per finding.
    private var nowCard: some View {
        let tooth = selection.tooth
        let r = theme.roles
        let findings = tooth.findings.isEmpty ? [SurfaceFinding(surface: nil, finding: .sound)] : tooth.findings
        return V7Card {
            HStack(spacing: 14) {
                Canvas { context, size in
                    var ctx = context
                    ToothPainter(tooth: tooth, palette: theme.palette, selected: false, selectedSurface: nil)
                        .draw(in: &ctx, geometry: ToothGeometry(tooth: tooth, size: size))
                }
                .frame(width: 48, height: 64)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    V7Label(text: pv("pv.tooth.now"))
                    ForEach(Array(findings.enumerated()), id: \.offset) { _, item in
                        HStack(spacing: 8) {
                            FindingSwatch(finding: item.finding)
                            Text("\(item.finding.label), \(tooth.surfaceText(item.surface))").v7Text(13).foregroundStyle(r.onSurface.color)
                        }
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder private var historyCard: some View {
        let r = theme.roles
        switch onEnum(of: selection.history) {
        case .loading:
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity)
        case .failed:
            Text(chartText("chart.history_failed")).v7Text(12.5).foregroundStyle(r.error.color)
        case .loaded(let loaded):
            if loaded.entries.isEmpty {
                V7Muted(chartText("chart.history_none"))
            } else {
                V7Card {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(loaded.entries, id: \.id) { entry in historyRow(entry) }
                    }
                }
            }
        }
    }

    private func historyRow(_ entry: HistoryEntryView) -> some View {
        let r = theme.roles
        let current = entry.status == .current
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(current ? r.primary.color : r.outline.color).frame(width: 10, height: 10)
                .overlay(Circle().stroke(current ? r.primaryContainer.color : .clear, lineWidth: 4))
                .padding(.top, 5).padding(.horizontal, 2)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(entry.finding.label), \(selection.tooth.surfaceText(entry.surface))").v7Text(14, .bold)
                    .foregroundStyle(current ? r.onSurface.color : r.onSurfaceVariant.color)
                if !entry.treatmentText.isEmpty { Text(entry.treatmentText).v7Text(13).foregroundStyle(r.onSurface.color) }
                if !entry.detailText.isEmpty { Text(entry.detailText).v7Text(12).foregroundStyle(r.onSurfaceVariant.color) }
            }
            Spacer(minLength: 4)
            if current && chart.canRecord {
                Button { sheet.startEdit(entry: entry, terms: chart.terms); adding = true } label: {
                    Text(pv("pv.tooth.edit")).v7Text(12, .bold).foregroundStyle(r.primary.color).frame(minWidth: 44, minHeight: 36)
                }
                .accessibilityLabel(pv("pv.tooth.edit") + ", " + entry.finding.label)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
