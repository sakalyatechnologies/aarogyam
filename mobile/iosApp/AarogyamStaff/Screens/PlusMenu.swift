import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the "+" menu opens besides the walk-in sheet.
enum PlusChoice: String, Identifiable {
    case addPatient, book
    var id: String { rawValue }
}

/// The bar's "+": a menu of walk-in, add patient only (`patients.write`) and book (`appointments.write`).
/// With one choice allowed it stays a plain button.
struct PlusMenu: View {
    let permissions: Set<String>
    @Binding var walkIn: Bool
    @Binding var plus: PlusChoice?

    private var canBook: Bool { permissions.contains("appointments.write") }
    private var canAdd: Bool { permissions.contains("patients.write") }

    var body: some View {
        if canBook || canAdd {
            Menu {
                Button { walkIn = true } label: { Label { Text("t7.plus.walk_in", tableName: "TodayV7") } icon: { Image(systemName: "person.badge.clock") } }
                if canAdd {
                    Button { plus = .addPatient } label: { Label { Text("t7.plus.add_patient", tableName: "TodayV7") } icon: { Image(systemName: "person.badge.plus") } }
                }
                if canBook {
                    Button { plus = .book } label: { Label { Text("t7.book.action", tableName: "TodayV7") } icon: { Image(systemName: "calendar.badge.plus") } }
                }
            } label: {
                Label { Text("v7.action.walk_in") } icon: { V7Icon.image("plus") }
            }
        } else {
            Button { walkIn = true } label: { Label { Text("v7.action.walk_in") } icon: { V7Icon.image("plus") } }
        }
    }
}

enum PlusSheets {
    @ViewBuilder static func content(_ choice: PlusChoice, graph: AppGraph, clinic: ClinicContext, onOpen: @escaping (String) -> Void) -> some View {
        switch choice {
        case .book:
            BookFlow(graph: graph, clinic: clinic, dateISO: IosDates.todayISO(zone: clinic.session.clinic.timezone), patientId: nil)
        case .addPatient:
            AddPatientSheet(graph: graph, clinic: clinic, onAdded: onOpen)
        }
    }
}

/// Register a patient with no queue token (`POST /patients`), then open their page.
private struct AddPatientSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onAdded: (String) -> Void

    var body: some View {
        SkSheetScaffold(String(localized: "t7.plus.add_patient", table: "TodayV7")) {
            ScreenHost(make: { graph.quickRegister(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                RegisterAndBook(
                    holder: holder, state: state, searched: "", onRegistered: onAdded,
                    submit: String(localized: "t7.newpt.add_submit", table: "TodayV7")
                )
            }
        }
        .skSheet()
    }
}
