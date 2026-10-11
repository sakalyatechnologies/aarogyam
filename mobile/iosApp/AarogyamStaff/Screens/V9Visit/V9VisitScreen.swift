import AarogyamShared
import SakalyaUI
import SwiftUI

/// Start treatment as one screen: the header, notes, an inline prescription, procedures and
/// close. Each part is its own file in this folder; this one owns the states around them.
struct V9VisitScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScreenHost(make: { graph.patient360(clinic: clinic, patientId: route.patientId, screen: $0) }, state: { $0.state }) { _, patient in
            ScreenHost(
                make: { graph.visit(clinic: clinic, patientId: route.patientId, tokenId: route.tokenId, appointmentId: route.appointmentId, screen: $0) },
                state: { $0.state }
            ) { holder, state in
                V9VisitStates(graph: graph, clinic: clinic, route: route, holder: holder, state: state, patient: patient)
            }
        }
        .background(theme.roles.background.color)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// Starting, not allowed and failed; the open visit is `V9OpenVisit`.
private struct V9VisitStates: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute
    let holder: VisitStateHolder
    let state: VisitState
    let patient: Patient360State
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch onEnum(of: state) {
        case .starting:
            SkLoadingIndicator(CL("c.visit.starting")).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notAllowed:
            SkEmptyState(CL("c.visit.not_allowed.title"), message: CL("c.visit.not_allowed.message"))
        case .failed(let failed):
            VStack(spacing: SkSpacing.l) {
                SkEmptyState(V9("v9v.failed.title"), message: failed.error.message)
                SkPillButton(V9("v9v.back"), variant: .tonal) { dismiss() }
            }
            .padding(SkSpacing.l)
        case .open(let open):
            V9OpenVisit(graph: graph, clinic: clinic, route: route, holder: holder, view: open.view, patient: patient)
        }
    }
}

/// The open visit: the prescription, chart and tooth-sheet holders it needs, then the content.
private struct V9OpenVisit: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute
    let holder: VisitStateHolder
    let view: VisitView_
    let patient: Patient360State

    var body: some View {
        ScreenHost(
            make: { graph.rxSheetInVisit(clinic: clinic, patientId: route.patientId, allergies: allergies, visitId: view.visitId, screen: $0) },
            state: { $0.state }
        ) { rx, rxState in
            ScreenHost(make: { graph.chart(clinic: clinic, patientId: route.patientId, screen: $0) }, state: { $0.state }) { chart, chartState in
                ScreenHost(make: { graph.toothSheet(clinic: clinic, chart: chart, visitId: view.visitId, screen: $0) }, state: { $0.form }) { sheet, form in
                    V9VisitContent(
                        clinic: clinic, route: route, holder: holder, view: view, patient: patient,
                        rx: rx, rxState: rxState, chart: chart, chartState: chartState, sheet: sheet, form: form
                    )
                }
            }
        }
    }

    private var person: PatientView? {
        if case .loaded(let loaded) = onEnum(of: patient) { loaded.view } else { nil }
    }

    private var allergies: [AllergyView] { person?.flags.allergies ?? [] }
}

/// What a closed visit shows: taken when Close is tapped, because the lists it came from are
/// then gone from the screen.
struct V9Snapshot {
    var procedures: [String] = []
    var notes = 0
    var rxNumber: String?
    var medicines = 0
    var followUp: Date?
    var feePaise: Int64?
}
