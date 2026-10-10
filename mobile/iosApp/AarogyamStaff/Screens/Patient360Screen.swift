import AarogyamShared
import SakalyaUI
import SwiftUI

/// What a Patient 360 sheet is open on.
enum PatientSheet: String, Identifiable {
    case book, share, rx
    var id: String { rawValue }
}

/// Patient 360 in the v7 design: a tonal header with flags and quick actions, pill tabs that sit
/// at the top while the page scrolls, the tab's content, and Send Rx and Share at the foot.
struct Patient360Screen: View {
    let holder: Patient360StateHolder
    let state: Patient360State
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let billing: BillingStateHolder
    let billingState: BillingState
    @State private var tab = PatientTab.chart
    @State private var sheet: PatientSheet?
    @State private var toast: String?
    @State private var shareRx: String?
    @State private var chartModel: ScreenModel<ChartStateHolder, ChartState>?
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                if let loaded {
                    loadedPage(loaded.view, error: loaded.error)
                } else {
                    placeholder.padding(.horizontal, SkSpacing.l)
                }
            }
        }
        .background(theme.roles.background.color)
        .refreshable { await refresh() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if loaded != nil {
                    Button { shareRx = nil; sheet = .share } label: { Label { Text(pv("pv.share")) } icon: { V7Icon(name: "share") } }
                }
            }
        }
        .sheet(item: $sheet) { sheetContent($0) }
        .skToast($toast)
        // A recorded payment changes the balance in the header, so reload the patient.
        .onChange(of: receipt) { _, new in if new != nil { holder.refresh() } }
        #if DEBUG && AARO_ENV_Local
        .onAppear { if let dev = DevLaunch.patientTab { tab = dev } }
        #endif
    }

    private var loaded: Patient360StateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    private var receipt: String? {
        if case .loaded(let value) = onEnum(of: billingState) { value.receipt } else { nil }
    }

    private var can: (clinical: Bool, issue: Bool, book: Bool) {
        let p = clinic.permissions
        return (p.contains("clinical.read"), p.contains("prescriptions.issue"), p.contains("appointments.write"))
    }

    private var billsHidden: Bool {
        if case .hidden = onEnum(of: billingState) { true } else { false }
    }

    @ViewBuilder private func loadedPage(_ view: PatientView, error: ScreenError?) -> some View {
        let tabs = PatientTab.visible(clinical: can.clinical, visits: view.visits != nil, bills: !billsHidden)
        let current = tabs.contains(tab) ? tab : (tabs.first ?? .chart)
        PatientHeader(view: view, canBook: can.book, onBook: { sheet = .book }, onPhoto: { toast = pv("pv.photo.preview") })
        if let error { Text(error.message).v7Text(12.5).foregroundStyle(theme.roles.error.color).padding(SkSpacing.l) }
        Section {
            VStack(alignment: .leading, spacing: 10) {
                tabBody(current, view: view)
                    .id(current)
                    .transition(.opacity)
                footer(view)
            }
            .padding(.horizontal, SkSpacing.l).padding(.top, 6).padding(.bottom, SkSpacing.xxl)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: current)
        } header: {
            PatientPillTabs(tabs: tabs, selection: current) { tab = $0 }
        }
    }

    @ViewBuilder private func tabBody(_ tab: PatientTab, view: PatientView) -> some View {
        switch tab {
        case .chart: chartTab
        case .visits: PatientVisitsTab(visits: view.visits ?? [])
        case .rx:
            PatientRxTab(graph: graph, clinic: clinic, patientId: patientId, allergies: view.flags.allergies) { shareRx = $0; sheet = .share }
        case .bills:
            PatientBillsTab(holder: billing, state: billingState, onUpi: { toast = pv("pv.upi.preview") })
        case .notes: NotesTab(graph: graph, clinic: clinic, patientId: patientId)
        case .files: FilesTab(graph: graph, clinic: clinic, patientId: patientId)
        }
    }

    private func footer(_ view: PatientView) -> some View {
        HStack(spacing: 8) {
            if can.issue && can.clinical {
                SkPillButton(pv("pv.send_rx"), variant: .fill, icon: V7Icon.path("rx"), wide: true) { sheet = .rx }
            }
            SkPillButton(pv("pv.share"), variant: .tonal, icon: V7Icon.path("share"), wide: true) { shareRx = nil; sheet = .share }
        }
        .padding(.top, 4)
    }

    @ViewBuilder private func sheetContent(_ sheet: PatientSheet) -> some View {
        switch sheet {
        case .book:
            PatientBookSheet(graph: graph, clinic: clinic, patientId: patientId, name: loaded?.view.name ?? "")
        case .share:
            PatientShareSheet(graph: graph, clinic: clinic, patientId: patientId, preselected: shareRx)
        case .rx:
            RxSheet(graph: graph, clinic: clinic, patientId: patientId, allergies: loaded?.view.flags.allergies ?? [])
        }
    }

    @ViewBuilder private var chartTab: some View {
        if let chartModel {
            ChartTab(holder: chartModel.holder, state: chartModel.value, graph: graph, clinic: clinic)
        } else {
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                .onAppear {
                    chartModel = ScreenModel(make: { graph.chart(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
                }
        }
    }

    @ViewBuilder private var placeholder: some View {
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "patient.not_allowed.title"), message: String(localized: "patient.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(String(localized: "patient.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded:
            EmptyView()
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? Patient360StateLoaded, now.refreshing { continue }
            break
        }
    }
}

/// The mockup's `.ptabs`: pills that scroll sideways and stay at the top; the chosen one is inverted.
struct PatientPillTabs: View {
    let tabs: [PatientTab]
    let selection: PatientTab
    let onSelect: (PatientTab) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tabs, id: \.self) { tab in
                    let on = tab == selection
                    Button { onSelect(tab) } label: {
                        Text(tab.title).v7Text(12.5, .bold)
                            .foregroundStyle((on ? r.background : r.onSurfaceVariant).color)
                            .padding(.horizontal, 14).frame(minHeight: 34)
                            .background((on ? r.onSurface : r.surface2).color, in: Capsule())
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.skPressable)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .padding(.top, 9).padding(.bottom, 1)
        .background(r.background.color)
    }
}
