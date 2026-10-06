import AarogyamShared
import SakalyaUI
import SwiftUI

/// Where a Patient 360 push goes; carries the ID only, never a name.
struct PatientRoute: Hashable {
    let id: String
}

/// The signed-in shell: Today, Patients and Calendar in a tab bar. Each tab keeps its state
/// holder while the person moves between tabs.
struct MainTabs: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onSwitchClinic: () -> Void
    @State private var patientsPath: [PatientRoute] = []
    @State private var calendarPath: [PatientRoute] = []

    var body: some View {
        TabView {
            NavigationStack {
                ScreenHost(make: { graph.today(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    TodayScreen(holder: holder, state: state, onSwitchClinic: onSwitchClinic, onSignOut: graph.signOut)
                }
            }
            .tabItem { Label(String(localized: "tab.today"), systemImage: "calendar.badge.clock") }

            NavigationStack(path: $patientsPath) {
                ScreenHost(make: { graph.patients(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    PatientsScreen(holder: holder, state: state) { patientsPath.append(PatientRoute(id: $0)) }
                }
                .patientDestination(graph: graph, clinic: clinic)
            }
            .tabItem { Label(String(localized: "tab.patients"), systemImage: "person.2") }

            NavigationStack(path: $calendarPath) {
                ScreenHost(make: { graph.calendar(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    CalendarScreen(holder: holder, state: state) { calendarPath.append(PatientRoute(id: $0)) }
                }
                .patientDestination(graph: graph, clinic: clinic)
            }
            .tabItem { Label(String(localized: "tab.calendar"), systemImage: "calendar") }
        }
    }
}

private extension View {
    func patientDestination(graph: AppGraph, clinic: ClinicContext) -> some View {
        navigationDestination(for: PatientRoute.self) { route in
            ScreenHost(make: { graph.patient360(clinic: clinic, patientId: route.id, screen: $0) }, state: { $0.state }) { holder, state in
                Patient360Screen(holder: holder, state: state)
            }
        }
    }
}
