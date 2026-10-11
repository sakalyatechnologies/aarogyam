import AarogyamShared
import SakalyaUI
import SwiftUI

/// What a Patient 360 sheet is open on.
enum PatientSheet: String, Identifiable {
    case book, share, photo
    var id: String { rawValue }
}

/// The patient page: the tonal header (flags, quick actions, the money strip for roles with money),
/// Start treatment for clinicians, then three pill tabs: Overview, History and Consent. A tap on a
/// visit pushes its detail. The holders live here so switching tabs does not reload them.
struct Patient360Screen: View {
    let holder: Patient360StateHolder
    let state: Patient360State
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let billing: BillingStateHolder
    let billingState: BillingState
    @State private var tab = PatientPageTab.overview
    @State private var sheet: PatientSheet?
    @State private var toast: String?
    @State private var visit: VisitRoute?
    @State private var detail: VisitDetailRoute?
    @State private var overview: ScreenModel<PatientOverviewStateHolder, OverviewState>?
    @State private var history: ScreenModel<VisitHistoryStateHolder, VisitHistoryState>?
    @State private var consents: ScreenModel<ConsentsStateHolder, ConsentsState>?
    @State private var chart: ScreenModel<ChartStateHolder, ChartState>?
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                if let loaded {
                    loadedPage(loaded.view, error: loaded.error)
                } else {
                    placeholder.padding(.horizontal, SkSpacing.l)
                }
            }
        }
        #if DEBUG && AARO_ENV_Local
        // Screenshot runs: `_DEV_SCROLL=1` scrolls the tab body to the top once the overview has loaded.
        .onChange(of: overviewLoaded != nil) { _, ready in
            if ready, ProcessInfo.processInfo.environment["AAROGYAM_DEV_SCROLL"] == "1" {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { proxy.scrollTo("p9.body", anchor: .top) }
            }
        }
        #endif
        }
        .background(theme.roles.background.color)
        .refreshable { await refresh() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if loaded != nil {
                    Button { sheet = .share } label: { Label { Text(pv("pv.share")) } icon: { V7Icon(name: "share") } }
                }
            }
        }
        .sheet(item: $sheet) { sheetContent($0) }
        .navigationDestination(item: $visit) { VisitScreen(graph: graph, clinic: clinic, route: $0) }
        .navigationDestination(item: $detail) {
            V9VisitDetail(graph: graph, clinic: clinic, patientId: patientId, visitId: $0.visitId, phone: loaded?.view.phone, billing: billing, billingState: billingState)
        }
        .skToast($toast)
        .onAppear(perform: makeModels)
        // A queued picture lands in the Overview tiles once the outbox has sent it.
        .task {
            var last = 0
            for await next in graph.outbox.pending {
                let now = Int(truncating: next)
                if last > 0, now == 0 { overview?.holder.refresh() }
                last = now
            }
        }
        // A recorded payment changes the balance in the header and the money strip, so reload them.
        .onChange(of: receipt) { _, new in
            if new != nil { holder.refresh(); overview?.holder.refresh(); history?.holder.refresh() }
        }
        #if DEBUG && AARO_ENV_Local
        .onAppear {
            if let dev = DevLaunch.patientTab9 { tab = dev }
            if ProcessInfo.processInfo.environment["AAROGYAM_DEV_PHOTO_SHEET"] == "1" { sheet = .photo }
            }
        .onChange(of: overviewMoney != nil) { _, has in
            if DevLaunch.showMoney, has, !overviewMoneyShown { overview?.holder.toggleMoney() }
        }
        .onChange(of: firstVisitId) { _, id in
            if DevLaunch.openFirstVisit, let id, detail == nil { detail = VisitDetailRoute(visitId: id) }
        }
        #endif
    }

    private func makeModels() {
        guard overview == nil else { return }
        let can = clinic.permissions
        if can.contains("clinical.read") {
            overview = ScreenModel(make: { graph.patientOverview(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
            chart = ScreenModel(make: { graph.chart(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
        }
        history = ScreenModel(make: { graph.visitHistory(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
        consents = ScreenModel(make: { graph.consents(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
    }

    private var loaded: Patient360StateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    private var receipt: String? {
        if case .loaded(let value) = onEnum(of: billingState) { value.receipt } else { nil }
    }

    private var overviewLoaded: OverviewStateLoaded? {
        if let overview, case .loaded(let value) = onEnum(of: overview.value) { value } else { nil }
    }

    private var overviewMoney: MoneySummary? { overviewLoaded?.money }
    private var overviewMoneyShown: Bool { overviewLoaded?.moneyShown ?? false }

    private var historyLoaded: VisitHistoryStateLoaded? {
        if let history, case .loaded(let value) = onEnum(of: history.value) { value } else { nil }
    }

    private var firstVisitId: String? { historyLoaded?.rows.first?.id }

    private var can: (book: Bool, treat: Bool) {
        let p = clinic.permissions
        return (p.contains("appointments.write"), p.contains("clinical.write"))
    }

    @ViewBuilder private func loadedPage(_ view: PatientView, error: ScreenError?) -> some View {
        let tabs = PatientPageTab.visible(permissions: Set(clinic.permissions))
        let current = tabs.contains(tab) ? tab : (tabs.first ?? .overview)
        PatientHeader(view: view, canBook: can.book, canPhoto: can.treat, onBook: { sheet = .book }, onPhoto: { sheet = .photo }) {
            OutboxBadge(graph: graph).frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 4)
            PatientMoneyStrip(model: MoneyStripModel.make(money: overviewMoney, shown: overviewMoneyShown)) {
                overview?.holder.toggleMoney()
            }
        }
        if let error { Text(error.message).v7Text(12.5).foregroundStyle(theme.roles.error.color).padding(SkSpacing.l) }
        if can.treat {
            SkPillButton(CL("c.visit.start"), variant: .warm, icon: V7Icon.path("tooth"), wide: true) { visit = VisitRoute(patientId: patientId) }
                .padding(.horizontal, SkSpacing.l).padding(.top, 12)
        }
        Section {
            VStack(alignment: .leading, spacing: 10) {
                tabBody(current)
                    .id(current)
                    .transition(.opacity)
            }
            .padding(.horizontal, SkSpacing.l).padding(.top, 6).padding(.bottom, SkSpacing.xxl)
            .id("p9.body")
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: current)
        } header: {
            PatientV9PillTabs(tabs: tabs, selection: current, historyCount: historyLoaded?.rows.count) { tab = $0 }
        }
    }

    @ViewBuilder private func tabBody(_ tab: PatientPageTab) -> some View {
        switch tab {
        case .overview:
            if let overview {
                V9OverviewTab(
                    holder: overview.holder, state: overview.value, chart: chart, graph: graph, clinic: clinic,
                    onOpenVisit: { detail = VisitDetailRoute(visitId: $0) }
                )
            }
        case .history:
            if let history {
                V9HistoryTab(holder: history.holder, state: history.value, clinic: clinic) { detail = VisitDetailRoute(visitId: $0) }
            }
        case .consent:
            if let consents { V9ConsentTab(holder: consents.holder, state: consents.value) }
        }
    }

    @ViewBuilder private func sheetContent(_ sheet: PatientSheet) -> some View {
        switch sheet {
        case .book:
            PatientBookSheet(graph: graph, clinic: clinic, patientId: patientId, name: loaded?.view.name ?? "")
        case .photo:
            V9PhotoSheet(graph: graph, clinic: clinic, patientId: patientId) { self.sheet = nil }
        case .share:
            PatientShareSheet(graph: graph, clinic: clinic, patientId: patientId, preselected: nil)
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
