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
    @State private var morePath: [MoreRoute] = []
    @State private var expenseRevision = 0
    @State private var intake: IntakeRequest?
    @State private var tasksOpen = false
    @State private var deskRevision = 0

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
        .background {
            // v10 hooks (plan R4): each draws nothing until its screen is built, in its own file.
            RoutesV10Desk.hook(graph: graph, clinic: clinic)
            RoutesV10Intake.hook(graph: graph, clinic: clinic)
            RoutesV10Doctor.hook(graph: graph, clinic: clinic)
            RoutesV10Tasks.hook(graph: graph, clinic: clinic)
        }
        .sheet(item: $intake) { request in
            RoutesV10Intake.screen(graph: graph, clinic: clinic, phone: request.phone.isEmpty ? nil : request.phone) {
                intake = nil
                deskRevision += 1
            }
        }
        .sheet(isPresented: $tasksOpen) { RoutesV10Tasks.screen(graph: graph, clinic: clinic) }
        .sheet(isPresented: $walkIn) { RoutesDesk.sheet(graph: graph, clinic: clinic) }
        .sheet(isPresented: $addExpense, onDismiss: { expenseRevision += 1 }) { ExpenseSheetHost(graph: graph, clinic: clinic) }
        .devClinicalHooks(graph: graph, clinic: clinic, selected: $selected, morePath: $morePath)
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
                VStack(spacing: 0) {
                    RoutesV10Doctor.waitingTop(graph: graph, clinic: clinic)
                    if TodayV10Logic.usesDesk(permissions: clinic.permissions) {
                        RoutesV10Desk.home(
                            graph: graph, clinic: clinic, onNewPatient: { intake = IntakeRequest(phone: $0) },
                            onOpenPatient: { todayPath.append(PatientRoute(id: $0)) }
                        )
                        .id(deskRevision)
                    } else {
                        RoutesA.today(
                            graph: graph, clinic: clinic, onOpenPatient: { todayPath.append(PatientRoute(id: $0)) },
                            onOpenSchedule: { selected = .schedule }, onAddExpense: { addExpense = true }
                        )
                    }
                }
                .toolbar {
                    if TodayV10Logic.showsTasks(permissions: clinic.permissions) {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { tasksOpen = true } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "checklist")
                                    RoutesV10Tasks.badge(graph: graph, clinic: clinic)
                                }
                            }
                            .accessibilityLabel(String(localized: "tasks10.title", table: "TasksV10"))
                        }
                    }
                }
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
                ClinicalRoutes.expensesPage(graph: graph, clinic: clinic, showsAdd: false)
                    .id(expenseRevision)
                    .barAction(nav.action, walkIn: $walkIn, addExpense: $addExpense)
            }
        case .more:
            NavigationStack(path: $morePath) {
                MoreScreen(graph: graph, clinic: clinic, nav: nav, onSwitchClinic: onSwitchClinic, path: $morePath)
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
