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

    // One "+" (founder, 23 Nov): it opens the one search, which finds the patient or starts a new one, and from
    // there checks in, books or just saves. No menu of separate flows.
    var body: some View {
        Button { walkIn = true } label: { Label { Text("v7.action.walk_in") } icon: { V7Icon.image("plus") } }
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
