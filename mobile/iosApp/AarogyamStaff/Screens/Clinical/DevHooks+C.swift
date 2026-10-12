import AarogyamShared
import SwiftUI

extension View {
    /// Local debug builds only: opens this worker's screens at launch for screenshots
    /// (`SIMCTL_CHILD_AAROGYAM_DEV_ROUTE=analytics|expenses|messages|team|chats|help|thread:<id>`,
    /// `AAROGYAM_DEV_VISIT=<patient id>`, `AAROGYAM_DEV_SHEET=expense|language|rx:<patient id>`).
    /// In other builds this is a no-op.
    func devClinicalHooks(graph: AppGraph, clinic: ClinicContext, selected: Binding<NavTab>, morePath: Binding<[MoreRoute]>) -> some View {
        #if DEBUG && AARO_ENV_Local
        modifier(DevClinicalHooks(graph: graph, clinic: clinic, selected: selected, morePath: morePath))
        #else
        self
        #endif
    }
}

#if DEBUG && AARO_ENV_Local
private struct DevClinicalHooks: ViewModifier {
    let graph: AppGraph
    let clinic: ClinicContext
    @Binding var selected: NavTab
    @Binding var morePath: [MoreRoute]
    @State private var visit: VisitRoute?
    @State private var rx: DevPatient?
    @State private var language = false
    @State private var expense = false

    func body(content: Content) -> some View {
        let env = ProcessInfo.processInfo.environment
        content
            .onAppear {
                switch env["AAROGYAM_DEV_ROUTE"]?.split(separator: ":").map(String.init) {
                case ["analytics"]: open(.analytics)
                case ["expenses"]: open(.expenses)
                case ["messages"]: open(.messages)
                case ["team"]: open(.team)
                case ["chats"]: open(.chats)
                case ["help"]: open(.help)
                case let parts? where parts.first == "thread" && parts.count == 2: open(.thread(id: parts[1], title: "Chat"))
                default: break
                }
                if let id = env["AAROGYAM_DEV_VISIT"] { visit = VisitRoute(patientId: id) }
                let sheet = env["AAROGYAM_DEV_SHEET"] ?? ""
                if sheet == "expense" { expense = true }
                if sheet == "language" { language = true }
                if sheet.hasPrefix("rx:") { rx = DevPatient(id: String(sheet.dropFirst(3))) }
            }
            .fullScreenCover(item: $visit) { route in NavigationStack { VisitScreen(graph: graph, clinic: clinic, route: route) } }
            .sheet(item: $rx) { RxSheet(graph: graph, clinic: clinic, patientId: $0.id, allergies: [], phone: "9876543210") }
            .sheet(isPresented: $language) { LanguageSheet().presentationDetents([.medium]) }
            .sheet(isPresented: $expense) { ExpenseSheetHost(graph: graph, clinic: clinic) }
    }

    private func open(_ route: MoreRoute) {
        selected = .more
        morePath = [route]
    }
}

extension VisitRoute: Identifiable {
    var id: String { patientId }
}

private struct DevPatient: Identifiable { let id: String }
#endif
