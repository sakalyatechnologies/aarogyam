import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Upcoming and past appointments at every linked clinic, with Cancel while the clinic allows it.
struct AppointmentsScreen: View {
    let graph: PatientGraph
    let onBook: () -> Void

    var body: some View {
        ScreenHost(make: { graph.appointments(screen: $0) }, state: { $0.state }) { holder, state in
            AppointmentsContent(holder: holder, state: state, onBook: onBook)
        }
        .navigationTitle(String(localized: "appointments.title"))
    }
}

private struct AppointmentsContent: View {
    let holder: AppointmentsStateHolder
    let state: AppointmentsState
    let onBook: () -> Void
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
                    lists(loaded)
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { holder.refresh() }
    }

    @ViewBuilder private func lists(_ loaded: AppointmentsStateLoaded) -> some View {
        let p = theme.palette
        if let error = loaded.cancelError {
            SkCard {
                Text(error == .tooLate ? "appointments.cancel.too_late" : "appointments.cancel.failed")
                    .skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color)
            }
        }
        Text("appointments.upcoming").skTextStyle(SkTypeScale.overline).foregroundStyle(p.textMuted.color)
        if loaded.upcoming.isEmpty {
            SkCard {
                Text("appointments.none_upcoming").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                SkButton(String(localized: "home.book"), action: onBook)
            }
        }
        ForEach(loaded.upcoming, id: \.id) { visit in
            VisitCard(visit: visit, cancelling: loaded.cancelling == visit.id) { holder.cancel(appointmentId: visit.id) }
        }
        Text("appointments.past").skTextStyle(SkTypeScale.overline).foregroundStyle(p.textMuted.color)
        if loaded.past.isEmpty {
            SkCard { Text("appointments.none_past").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color) }
        }
        ForEach(loaded.past, id: \.id) { visit in VisitCard(visit: visit, cancelling: false, onCancel: nil) }
    }
}

private struct VisitCard: View {
    let visit: AppointmentView
    let cancelling: Bool
    let onCancel: (() -> Void)?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.xs) {
                HStack {
                    Text(visit.at?.text ?? "").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                    Spacer()
                    SkChip(visit.status.label, tone: visit.status.tone)
                }
                Text(visit.whoAndWhere).skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                if let onCancel, visit.canCancel {
                    SkButton(String(localized: "appointments.cancel"), variant: .secondary, action: onCancel).disabled(cancelling)
                }
            }
        }
    }
}
