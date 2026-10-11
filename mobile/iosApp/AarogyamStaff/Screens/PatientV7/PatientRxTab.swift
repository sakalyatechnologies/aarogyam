import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Rx tab: the patient's prescriptions as the mockup's cards, each with its status pill and a Share button.
struct PatientRxTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let allergies: [AllergyView]
    let onShare: (String) -> Void

    var body: some View {
        ScreenHost(make: { graph.rxList(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            RxCards(holder: holder, state: state, onShare: onShare)
        }
    }
}

private struct RxCards: View {
    let holder: RxListStateHolder
    let state: RxListState
    let onShare: (String) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xl)
        case .notAllowed:
            V7Card { V7Muted(String(localized: "rx.not_allowed")) }
        case .failed(let failed):
            SkEmptyState(pv("pv.tab.rx"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .loaded(let loaded):
            if loaded.items.isEmpty {
                V7Card { V7Muted(pv("pv.rx.none")).frame(maxWidth: .infinity) }
            }
            ForEach(loaded.items, id: \.id) { rx in
                V7Card {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(rx.number ?? pv("pv.rx.draft")).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                            Spacer()
                            V7Pill(text: rx.status.label, kind: rx.status == .issued ? .done : rx.status == .cancelled ? .error : .warm)
                        }
                        if let at = rx.at { V7Muted(ClinicFormat.date(iso: at.date.isoText)) }
                        VStack(spacing: 6) {
                            ForEach(Array(rx.medicines.enumerated()), id: \.offset) { _, m in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(m.name).v7Text(13, .semibold).foregroundStyle(r.onSurface.color)
                                    if !m.detailText.isEmpty { Text(m.detailText).v7Text(12).foregroundStyle(r.onSurfaceVariant.color) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 11).padding(.horizontal, 12)
                                .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                        }
                        if rx.allergyOverridden { V7Pill(text: String(localized: "rx.allergy_overridden"), kind: .error) }
                        if rx.status == .issued && loaded.canIssue {
                            SkPillButton(pv("pv.share"), variant: .tonal, icon: V7Icon.path("share")) { onShare(rx.id) }
                        }
                    }
                }
            }
        }
    }
}
