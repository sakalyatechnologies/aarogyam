import AarogyamShared
import SakalyaUI
import SwiftUI

/// Where a Patient 360 push goes; carries the ID only, never a name.
struct PatientRoute: Hashable {
    let id: String
}

/// The signed-in shell of the v7 design: the system tab bar (glass on iOS 26) with the tabs the
/// role's permissions give (NavModel), and the bar action (walk-in or add expense) as a glass
/// toolbar button. Each tab keeps its state holder while the person moves between tabs.
struct MainTabs: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onSwitchClinic: () -> Void
    @State private var clinicCount: Int32 = 1
    @State private var selected: NavTab = .today
    @State private var patientsPath: [PatientRoute] = []
    @State private var todayPath: [PatientRoute] = []
    @State private var schedulePath: [PatientRoute] = []
    @State private var walkIn = false
    @State private var addExpense = false

    private var nav: NavModel { NavModel.companion.of(permissions: clinic.permissions, clinicCount: clinicCount) }

    var body: some View {
        let nav = nav
        TabView(selection: $selected) {
            ForEach(nav.tabs, id: \.self) { tab in
                content(tab, nav: nav)
                    .tabItem { Label { Text(tab.title) } icon: { V7Icon.image(tab.iconName) } }
                    .tag(tab)
            }
        }
        .minimizingTabBar()
        .sheet(isPresented: $walkIn) {
            ScreenHost(make: { graph.walkIn(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                WalkInScreen(holder: holder, state: state)
            }
        }
        .task { clinicCount = await countClinics() }
        #if DEBUG && AARO_ENV_Local
        .onAppear {
            if let tab = DevLaunch.tab { selected = tab }
            if DevLaunch.sheet == "walkin" { walkIn = true }
        }
        #endif
    }

    @ViewBuilder private func content(_ tab: NavTab, nav: NavModel) -> some View {
        switch tab {
        case .today:
            NavigationStack(path: $todayPath) {
                RoutesA.today(
                    graph: graph, clinic: clinic, onOpenPatient: { todayPath.append(PatientRoute(id: $0)) },
                    onOpenSchedule: { selected = .schedule }, onAddExpense: { addExpense = true }
                )
                .barAction(nav.action, walkIn: $walkIn, addExpense: $addExpense)
                .patientDestination(graph: graph, clinic: clinic)
            }
        case .patients:
            NavigationStack(path: $patientsPath) {
                ScreenHost(make: { graph.patients(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    PatientsScreen(holder: holder, state: state) { patientsPath.append(PatientRoute(id: $0)) }
                }
                .barAction(nav.action, walkIn: $walkIn, addExpense: $addExpense)
                .patientDestination(graph: graph, clinic: clinic)
            }
        case .schedule:
            NavigationStack(path: $schedulePath) {
                ScheduleTab(graph: graph, clinic: clinic, onOpenPatient: { schedulePath.append(PatientRoute(id: $0)) }, onWalkIn: { walkIn = true })
                    .barAction(nav.action, walkIn: $walkIn, addExpense: $addExpense)
                    .patientDestination(graph: graph, clinic: clinic)
            }
        case .expenses:
            NavigationStack {
                PreviewPage(title: tab.title)
                    .barAction(nav.action, walkIn: $walkIn, addExpense: $addExpense)
            }
        case .more:
            NavigationStack {
                MoreScreen(graph: graph, clinic: clinic, nav: nav, onSwitchClinic: onSwitchClinic)
            }
        }
    }

    /// The person's clinic count, for "Switch clinic"; one when it cannot be read.
    private func countClinics() async -> Int32 {
        guard let result = try? await graph.directory.clinics(refresh: false) else { return 1 }
        if case .success(let ok) = onEnum(of: result), let list = ok.value as? [Any] { return Int32(max(list.count, 1)) }
        return 1
    }
}

/// The shared module's tab (SwiftUI has its own `Tab`).
typealias NavTab = AarogyamShared.Tab

extension NavTab {
    var title: String {
        switch self {
        case .today: String(localized: "tab.today")
        case .patients: String(localized: "tab.patients")
        case .schedule: String(localized: "v7.tab.schedule")
        case .expenses: String(localized: "v7.tab.expenses")
        case .more: String(localized: "v7.tab.more")
        }
    }

    /// The mockup's tab icons (TABDEF): home, users, cal, wallet (finance's Expenses), grid.
    var iconName: String {
        switch self {
        case .today: "home"
        case .patients: "users"
        case .schedule: "cal"
        case .expenses: "wallet"
        case .more: "grid"
        }
    }
}

private extension View {
    /// The role's bar action as a glass toolbar button: New walk-in, or Add expense for finance.
    @ViewBuilder func barAction(_ action: PrimaryAction?, walkIn: Binding<Bool>, addExpense: Binding<Bool>) -> some View {
        switch action {
        case .walkIn:
            toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { walkIn.wrappedValue = true } label: {
                        Label { Text("v7.action.walk_in") } icon: { V7Icon.image("plus") }
                    }
                }
            }
        case .addExpense:
            toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { addExpense.wrappedValue = true } label: {
                        Label { Text("v7.action.add_expense") } icon: { V7Icon.image("wallet") }
                    }
                }
            }
        default:
            self
        }
    }

    /// iOS 26 shrinks the glass tab bar while scrolling down; earlier systems keep it.
    @ViewBuilder func minimizingTabBar() -> some View {
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }
}

extension View {
    func patientDestination(graph: AppGraph, clinic: ClinicContext) -> some View {
        navigationDestination(for: PatientRoute.self) { route in
            ScreenHost(make: { graph.billing(clinic: clinic, patientId: route.id, screen: $0) }, state: { $0.state }) { billing, billingState in
                ScreenHost(make: { graph.patient360(clinic: clinic, patientId: route.id, screen: $0) }, state: { $0.state }) { holder, state in
                    Patient360Screen(
                        holder: holder, state: state, graph: graph, clinic: clinic, patientId: route.id,
                        billing: billing, billingState: billingState
                    )
                }
            }
        }
    }
}

/// The designed state for a page whose server support or screen is not built yet.
struct PreviewPage: View {
    let title: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.l) {
                SkLargeTitleHeader(title)
                PreviewNotice()
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }
}

/// "Preview: needs server support", the marker on every part of v7 the server cannot fill yet.
struct PreviewNotice: View {
    var text: String = String(localized: "v7.preview")
    @Environment(\.skTheme) private var theme

    var body: some View {
        HStack(spacing: SkSpacing.s) {
            V7Icon(name: "spark", size: 16, tint: theme.roles.onTertiaryContainer.color)
            Text(text).skTextStyle(SkTypeScale.caption).foregroundStyle(theme.roles.onTertiaryContainer.color)
        }
        .padding(.horizontal, SkSpacing.m)
        .padding(.vertical, SkSpacing.s)
        .background(theme.roles.tertiaryContainer.color, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
