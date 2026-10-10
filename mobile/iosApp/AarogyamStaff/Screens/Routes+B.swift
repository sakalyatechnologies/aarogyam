import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Labs page (More, Lab work): the shared `LabsStateHolder` in the v7 screens.
struct LabsRoute: View {
    let graph: AppGraph
    let clinic: ClinicContext

    var body: some View {
        ScreenHost(make: { graph.labs(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            LabsScreen(holder: holder, state: state, graph: graph, clinic: clinic)
        }
    }
}

#if DEBUG && AARO_ENV_Local
/// Screenshot runs for the patient pages: `SIMCTL_CHILD_AAROGYAM_DEV_OPEN_FIRST=1` opens the first
/// patient, `_DEV_PTAB=visits`, `_DEV_TOOTH=46` the tooth sheet and `_DEV_TOOTH_FORM=1` its form.
extension DevLaunch {
    static var openFirstPatient: Bool { ProcessInfo.processInfo.environment["AAROGYAM_DEV_OPEN_FIRST"] == "1" }

    static var patientTab: PatientTab? {
        switch ProcessInfo.processInfo.environment["AAROGYAM_DEV_PTAB"] {
        case "visits": .visits
        case "rx": .rx
        case "bills": .bills
        case "notes": .notes
        case "files": .files
        case "chart": .chart
        default: nil
        }
    }

    static var tooth: Int32? { ProcessInfo.processInfo.environment["AAROGYAM_DEV_TOOTH"].flatMap { Int32($0) } }

    static var toothForm: Bool { ProcessInfo.processInfo.environment["AAROGYAM_DEV_TOOTH_FORM"] == "1" }
}
#endif
