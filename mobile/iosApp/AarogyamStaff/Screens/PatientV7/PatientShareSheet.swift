import AarogyamShared
import SakalyaUI
import SwiftUI

extension RecordKind {
    var title: String {
        switch self {
        case .chart: pv("pv.share.chart")
        case .xrays: pv("pv.share.xrays")
        case .bills: pv("pv.share.bills")
        }
    }
}

extension ShareExpiry {
    var title: String {
        switch self {
        case .hour: pv("pv.share.hour")
        case .day: pv("pv.share.day")
        case .week: pv("pv.share.week")
        }
    }
}

/// "Share record": pick what to include and how long the link works, make it (`POST /patients/{id}/record-shares`)
/// and open the system share sheet. The PIN is shown once and is told to the patient apart from the link.
struct PatientShareSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String

    var body: some View {
        ScreenHost(make: { graph.recordShares(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            ShareBody(holder: holder, state: state, clinicName: clinic.session.clinic.name)
        }
    }
}

private struct ShareBody: View {
    let holder: RecordSharesStateHolder
    let state: RecordSharesState
    let clinicName: String
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(pv("pv.share.title"), subtitle: pv("pv.share.message"))
                if case .ready(let ready) = onEnum(of: state.phase) {
                    readyView(ready)
                } else if !state.allowed {
                    V7Muted(pv("pv.share.no_kinds"))
                } else {
                    form
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .skSheet()
    }

    private var creating: Bool {
        if case .creating = onEnum(of: state.phase) { true } else { false }
    }

    @ViewBuilder private var form: some View {
        let r = theme.roles
        V7Label(text: pv("pv.share.expires"))
        SkChoiceChips([ShareExpiry.hour, .day, .week], selected: [state.expiry], label: { $0.title }) { holder.setExpiry(expiry: $0) }
        SkChoiceChips(state.kinds, selected: Set(state.selected), label: { $0.title }) { holder.toggle(kind: $0) }
        if case .failed = onEnum(of: state.phase) {
            Text(pv("pv.share.failed")).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
        }
        SkPillButton(pv("pv.share.create"), wide: true, loading: creating) { holder.create() }
            .disabled(state.selected.isEmpty)
        V7Label(text: pv("pv.share.active"))
        if state.links.isEmpty { V7Muted(pv("pv.share.none")) }
        // TODO(BK-9): Revoke on each usable link, once the API has a revoke route for record shares.
        ForEach(state.links, id: \.id) { link in
            Text(link.kinds.map { $0.title }.joined(separator: " · ")).v7Text(13.5, .semibold).foregroundStyle(r.onSurface.color)
            V7Muted(status(link) + " · " + pvf("pv.share.opened", Int(link.openCount)))
        }
    }

    private func status(_ link: ShareRow) -> String {
        switch link.state {
        case .usable: pvf("pv.share.usable", link.expiresOn.map { ClinicFormat.date(iso: $0.isoText) } ?? "")
        case .expired: pv("pv.share.expired")
        case .locked: pv("pv.share.locked")
        }
    }

    @ViewBuilder private func readyView(_ ready: SharePhaseReady) -> some View {
        let r = theme.roles
        if let expires = ready.expiresOn { V7Muted(pvf("pv.share.expires_on", ClinicFormat.date(iso: expires.isoText))) }
        if let url = URL(string: ready.url) {
            ShareLink(item: url, subject: Text(pv("pv.share.title")), message: Text(pvf("pv.share.text", clinicName))) {
                Text(pv("pv.share.send")).v7Text(14, .bold).foregroundStyle(r.onPrimary.color)
                    .frame(maxWidth: .infinity, minHeight: 44).background(r.primary.color, in: Capsule())
            }
        }
        SkPillButton(pv("pv.share.another"), variant: .tonal, wide: true) { holder.reset() }
        SkPillButton(String(localized: "done"), variant: .ghost, wide: true) { dismiss() }
    }
}
