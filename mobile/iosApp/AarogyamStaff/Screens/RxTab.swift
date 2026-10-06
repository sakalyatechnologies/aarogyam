import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Rx tab of Patient 360: the patient's prescriptions, newest first, and a way to write one.
struct RxTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let allergies: [AllergyView]

    var body: some View {
        ScreenHost(make: { graph.rxList(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            RxList(holder: holder, state: state, graph: graph, clinic: clinic, patientId: patientId, allergies: allergies)
        }
    }
}

private struct RxList: View {
    let holder: RxListStateHolder
    let state: RxListState
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let allergies: [AllergyView]
    @State private var composing = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) { content }
                .padding(.horizontal, SkSpacing.l)
                .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { await refresh() }
        .sheet(isPresented: $composing, onDismiss: holder.refresh) {
            RxSheet(graph: graph, clinic: clinic, patientId: patientId, allergies: allergies)
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "patient.tab.rx"), message: String(localized: "rx.not_allowed"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "patient.tab.rx"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            if let error = loaded.error {
                Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
            }
            if loaded.canIssue {
                SkButton(String(localized: "rx.new")) { composing = true }
            }
            if loaded.items.isEmpty {
                Text(String(localized: "rx.empty")).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
            }
            ForEach(loaded.items, id: \.id) { card($0) }
        }
    }

    private func card(_ rx: RxSummary) -> some View {
        let p = theme.palette
        return SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack {
                    Text(rx.titleText).skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                    Spacer()
                    SkChip(rx.status.label, tone: rx.status.tone)
                }
                if let diagnosis = rx.diagnosis {
                    Text(diagnosis).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                }
                ForEach(Array(rx.medicines.enumerated()), id: \.offset) { _, medicine in
                    VStack(alignment: .leading, spacing: SkSpacing.xxs) {
                        Text(medicine.name).skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color)
                        if !medicine.detailText.isEmpty {
                            Text(medicine.detailText).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                        }
                    }
                }
                if rx.allergyOverridden { SkChip(String(localized: "rx.allergy_overridden"), tone: .warning) }
            }
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? RxListStateLoaded, now.refreshing { continue }
            break
        }
    }
}
