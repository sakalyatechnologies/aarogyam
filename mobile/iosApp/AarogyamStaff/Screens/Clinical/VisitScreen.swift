import AarogyamShared
import SakalyaUI
import SwiftUI

/// Where the Visit screen opens: from the queue's Start treatment or a patient's page. Carries
/// IDs only, never a name. `chair` is the chair number when the queue knows it.
struct VisitRoute: Hashable {
    let patientId: String
    var tokenId: String?
    var appointmentId: String?
    var chair: Int?
}

/// Start treatment: the one-screen v9 visit (see `Screens/V9Visit`). The state holder starts the
/// visit when this screen appears (from the queue token when there is one).
struct VisitScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute

    var body: some View {
        V9VisitScreen(graph: graph, clinic: clinic, route: route)
    }
}
