import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Places Home opens.
enum Route: Hashable {
    case appointments, book, prescriptions, bills, clinics
}

/// Home: the next visit, booking, prescriptions and bills, from every linked clinic.
struct HomeScreen: View {
    let graph: PatientGraph
    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScreenHost(make: { graph.home(screen: $0) }, state: { $0.state }) { holder, state in
                HomeContent(holder: holder, state: state, open: { path.append($0) })
            }
            .navigationTitle(String(localized: "home.greeting"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(String(localized: "sign_out"), action: graph.signOut) }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .appointments: AppointmentsScreen(graph: graph, onBook: { path.append(.book) })
                case .book: BookScreen(graph: graph, onDone: { path.removeLast() })
                case .prescriptions: PrescriptionsScreen(graph: graph)
                case .bills: BillsScreen(graph: graph)
                case .clinics: ClinicsScreen(graph: graph)
                }
            }
        }
    }
}

private struct HomeContent: View {
    let holder: HomeStateHolder
    let state: HomeState
    let open: (Route) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                switch onEnum(of: state) {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .failed(let failed):
                    SkEmptyState(failed.error.message, message: "", actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    home(loaded.view)
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { holder.refresh() }
    }

    @ViewBuilder private func home(_ view: HomeView) -> some View {
        let p = theme.palette
        Text("home.subtitle").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
        if let next = view.next {
            Button { open(.appointments) } label: {
                SkHeroCard(kicker: String(localized: "home.next_visit"), title: next.at?.text ?? "", subtitle: next.whoAndWhere)
            }
            .buttonStyle(.plain)
        } else {
            SkCard {
                Text("home.no_visit.title").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                Text("home.no_visit.message").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
            }
        }
        SkButton(String(localized: "home.book"), systemImage: "calendar.badge.plus") { open(.book) }
        SkButton(String(localized: "home.appointments"), variant: .secondary) { open(.appointments) }
        HStack(spacing: SkSpacing.ml) {
            Button { open(.prescriptions) } label: {
                SkStatTile(value: "\(view.prescriptions)", label: String(localized: "prescriptions.title"))
            }
            .buttonStyle(.plain)
            Button { open(.bills) } label: {
                SkStatTile(
                    value: view.balancePaise > 0 ? ClinicFormat.rupees(paise: view.balancePaise) : String(localized: "bills.all_paid"),
                    label: view.balancePaise > 0 ? String(localized: "bills.due") : String(localized: "bills.title")
                )
            }
            .buttonStyle(.plain)
        }
        Text("clinics.title").skTextStyle(SkTypeScale.overline).foregroundStyle(p.textMuted.color)
        SkCard(padding: 0) {
            ForEach(view.clinics, id: \.clinic.id) { summary in
                Button { open(.clinics) } label: {
                    SkListRow(
                        summary.clinic.name,
                        subtitle: String(format: String(localized: "clinic.number"), summary.clinic.patientNumber),
                        leading: { SkAvatar(summary.clinic.name) },
                        trailing: {
                            Text(summary.balancePaise > 0 ? ClinicFormat.rupees(paise: summary.balancePaise) : String(localized: "bills.all_paid"))
                                .skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                        }
                    )
                }
                .buttonStyle(.plain)
            }
        }
        SkButton(String(localized: "clinics.add.title"), variant: .secondary) { open(.clinics) }
    }
}
