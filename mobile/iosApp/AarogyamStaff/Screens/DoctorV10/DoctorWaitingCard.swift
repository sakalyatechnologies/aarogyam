import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// The doctor's "Waiting for you" card, inline at the top of the Today tab. A new arrival shows the banner and a
/// haptic. Send in keeps the row, which then offers Start visit (`onStart`). Only the Doctor home draws it.
struct DoctorWaitingHook: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onStart: (VisitRoute) -> Void

    var body: some View {
        ScreenHost(make: { graph.homeChoice(clinic: clinic, screen: $0) }, state: { $0.choice }) { _, choice in
            if choice.home == .doctor, let practitioner = choice.practitionerId {
                DoctorWaitingHost(graph: graph, clinic: clinic, practitionerId: practitioner, onStart: onStart)
            }
        }
    }
}

private struct DoctorWaitingHost: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let practitionerId: String
    let onStart: (VisitRoute) -> Void

    var body: some View {
        ScreenHost(make: { graph.doctorWaiting(clinic: clinic, practitionerId: practitionerId, screen: $0) }, state: { $0.state }) { holder, state in
            DoctorWaitingPresenter(holder: holder, state: state, onStart: onStart)
        }
    }
}

private struct DoctorWaitingPresenter: View {
    let holder: DoctorWaitingHolder
    let state: WaitingState
    let onStart: (VisitRoute) -> Void
    @State private var collapsed = false
    @State private var known: Set<String>?
    @State private var banner: String?

    var body: some View {
        Group {
            if collapsed {
                Button(dv10("dv10.waiting.title")) { collapsed = false }
                    .v7Text(15, .bold).frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget)
            } else if state.loaded && state.rows.isEmpty && banner == nil {
                // Nobody waiting: one quiet line, so Today keeps the screen.
                HStack {
                    Text(dv10("dv10.waiting.title")).v7Text(15, .bold)
                    Spacer()
                    Text(dv10("dv10.waiting.empty")).v7Text(14)
                }
                .padding(.horizontal, SkSpacing.l).frame(minHeight: SkSpacing.minTouchTarget)
            } else {
                DoctorWaitingCard(holder: holder, state: state, banner: banner, onStart: onStart) { collapsed = true }
                    .frame(maxHeight: 300)
            }
        }
        .onChange(of: state.rows.map(\.id)) { _, ids in arrivals(ids) }
        .onAppear { if state.loaded { arrivals(state.rows.map(\.id)) } }
        // Leaving for the visit, then coming back, should show the queue as it is now.
        .onAppear { holder.refresh() }
    }

    /// The first list only sets what is known; a token that was not there before is an arrival.
    private func arrivals(_ ids: [String]) {
        let now = Set(ids)
        defer { known = now }
        guard let known else { return }
        guard let fresh = state.rows.first(where: { !known.contains($0.id) }) else { return }
        banner = dv10f("dv10.waiting.banner", String(fresh.tokenNumber))
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        collapsed = false
    }
}

struct DoctorWaitingCard: View {
    let holder: DoctorWaitingHolder
    let state: WaitingState
    var banner: String?
    let onStart: (VisitRoute) -> Void
    let onClose: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                HStack {
                    Text(dv10("dv10.waiting.title")).v7Text(20, .heavy).foregroundStyle(r.onSurface.color)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    Button(dv10("dv10.close"), action: onClose).v7Text(15, .bold).frame(minHeight: SkSpacing.minTouchTarget)
                }
                if let banner {
                    Text(banner).v7Text(14, .bold).foregroundStyle(r.onPrimaryContainer.color)
                        .padding(SkSpacing.m).frame(maxWidth: .infinity, alignment: .leading)
                        .background(r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 14))
                        .accessibilityAddTraits(.isStaticText)
                }
                if state.failed { Text(dv10("dv10.waiting.offline")).v7Text(13, .semibold).foregroundStyle(r.error.color) }
                if state.rows.isEmpty {
                    Text(dv10("dv10.waiting.empty")).v7Text(14).foregroundStyle(r.onSurfaceVariant.color)
                }
                ForEach(state.rows, id: \.id) { row in WaitingRow(holder: holder, row: row, onStart: onStart) }
            }
            .padding(SkSpacing.l)
        }
        .background(r.background.color)
    }
}

private struct WaitingRow: View {
    let holder: DoctorWaitingHolder
    let row: WaitingPatient
    let onStart: (VisitRoute) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let token = String(row.tokenNumber)
        let who = DoctorV10Format.ageSex(age: row.ageYears.map { Int(truncating: $0) }, sex: row.sex)
        HStack(alignment: .center, spacing: SkSpacing.m) {
            VStack(alignment: .leading, spacing: 4) {
                Text(dv10f("dv10.token", token)).v7Text(18, .heavy).foregroundStyle(r.onSurface.color)
                if !who.isEmpty { Text(who).v7Text(13).foregroundStyle(r.onSurfaceVariant.color) }
                if let reason = row.reason { Text(reason).v7Text(13, .semibold).foregroundStyle(r.onSurface.color).lineLimit(2) }
                Text(row.called ? dv10("dv10.called") : dv10f("dv10.wait", String(row.waitMinutes)))
                    .v7Text(12.5, .semibold).foregroundStyle(row.called ? r.primary.color : r.onSurfaceVariant.color)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(dv10f("dv10.waiting.row.a11y", token, who, String(row.waitMinutes), row.reason ?? ""))
            Spacer(minLength: 8)
            if row.called {
                // The visit screen starts the visit from the token, which seats it on the server.
                SkPillButton(dv10("dv10.start"), variant: .fill) {
                    onStart(.fromQueue(patientId: row.patientId, tokenId: row.id, chair: nil))
                }
                .accessibilityLabel(dv10f("dv10.start.a11y", token))
            } else {
                SkPillButton(dv10("dv10.sendin"), variant: .fill) { holder.sendIn(id: row.id) }
                    .disabled(row.busy)
                    .accessibilityLabel(dv10f("dv10.sendin.a11y", token))
            }
        }
        .padding(SkSpacing.m)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16))
    }
}
