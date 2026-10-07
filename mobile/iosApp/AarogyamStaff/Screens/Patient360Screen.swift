import AarogyamShared
import SakalyaUI
import SwiftUI

/// Patient 360: Overview (banner, contact, upcoming, visits and, with `billing.read`, the balance), Chart, Rx, Notes and Billing tabs.
struct Patient360Screen: View {
    let holder: Patient360StateHolder
    let state: Patient360State
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let billing: BillingStateHolder
    let billingState: BillingState
    @Environment(\.skTheme) private var theme
    @State private var tab = 0
    /// The Chart tab's state holder, kept across tab switches.
    @State private var chartModel: ScreenModel<ChartStateHolder, ChartState>?

    private static let tabs: [String] = [
        String(localized: "patient.tab.overview"),
        chartText("patient.tab.chart"),
        String(localized: "patient.tab.rx"),
        String(localized: "patient.tab.notes"),
        String(localized: "patient.tab.files"),
        chartText("patient.tab.billing"),
    ]

    /// Without `billing.read` the Billing tab does not exist.
    private var tabs: [String] {
        if case .hidden = onEnum(of: billingState) { Array(Self.tabs.dropLast()) } else { Self.tabs }
    }

    var body: some View {
        VStack(spacing: SkSpacing.m) {
            if loaded != nil {
                SkSegmentedControl(tabs, selection: $tab)
                    .padding(.horizontal, SkSpacing.l)
            }
            if loaded != nil, tab == 1 {
                chartTab
            } else if let loaded, tab == 2 {
                RxTab(graph: graph, clinic: clinic, patientId: patientId, allergies: loaded.view.flags.allergies)
            } else if loaded != nil, tab == 3 {
                NotesTab(graph: graph, clinic: clinic, patientId: patientId)
            } else if loaded != nil, tab == 4 {
                FilesTab(graph: graph, clinic: clinic, patientId: patientId)
            } else if loaded != nil, tab == 5 {
                BillingTab(holder: billing, state: billingState)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: SkSpacing.ml) {
                        content
                    }
                    .padding(.horizontal, SkSpacing.l)
                    .padding(.bottom, SkSpacing.xxl)
                }
                .refreshable { await refresh() }
            }
        }
        .navigationTitle(loaded?.view.name ?? String(localized: "patient.title"))
        .navigationBarTitleDisplayMode(.inline)
        // A recorded payment changes the balance on the Overview, so reload the patient.
        .onChange(of: receipt) { _, new in if new != nil { holder.refresh() } }
    }

    private var receipt: String? {
        if case .loaded(let value) = onEnum(of: billingState) { value.receipt } else { nil }
    }

    @ViewBuilder private var chartTab: some View {
        if let chartModel {
            ChartTab(holder: chartModel.holder, state: chartModel.value)
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                .onAppear {
                    chartModel = ScreenModel(make: { graph.chart(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state })
                }
        }
    }

    private var loaded: Patient360StateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "patient.not_allowed.title"), message: String(localized: "patient.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "patient.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            PatientOverview(state: loaded)
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? Patient360StateLoaded, now.refreshing { continue }
            break
        }
    }
}

private struct PatientOverview: View {
    let state: Patient360StateLoaded
    @Environment(\.skTheme) private var theme

    var body: some View {
        let view = state.view
        let p = theme.palette
        if let error = state.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
        }
        HStack(spacing: SkSpacing.m) {
            SkAvatar(view.name)
            VStack(alignment: .leading, spacing: SkSpacing.xxs) {
                Text(view.headerText).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(p.text.color)
                if let phone = view.phone { Text(phone).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color) }
                Text(view.language).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            }
            Spacer()
            if view.recallDue { SkChip(String(localized: "recall_due"), tone: .warning) }
        }
        banner(view.flags)
        section("patient.upcoming") {
            if let next = view.upcoming.first {
                SkListRow(next.at.text, subtitle: next.practitioner)
            } else {
                muted("patient.upcoming.none")
            }
        }
        if let visits = view.visits {
            section("patient.visits") {
                if visits.isEmpty { muted("patient.visits.none") }
                ForEach(Array(visits.enumerated()), id: \.element.id) { index, visit in
                    if index > 0 { SkDivider() }
                    SkListRow(ClinicFormat.date(iso: visit.at.date.isoText), subtitle: visit.subtitleText) {
                        EmptyView()
                    } trailing: {
                        if visit.open { SkChip(String(localized: "patient.visit.open"), tone: .brand) }
                    }
                }
            }
        }
        if let balance = view.balancePaise?.int64Value {
            section("patient.balance") {
                if balance > 0 {
                    Text(String(format: String(localized: "patient.balance.due"), ClinicFormat.rupees(paise: balance)))
                        .skTextStyle(SkTypeScale.headline).foregroundStyle(p.dangerText.color)
                } else {
                    muted("patient.balance.clear")
                }
            }
        }
    }

    private func muted(_ key: String.LocalizationValue) -> some View {
        Text(String(localized: key)).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
    }

    private func section(_ title: String.LocalizationValue, @ViewBuilder content: () -> some View) -> some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(String(localized: title)).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                    .accessibilityAddTraits(.isHeader)
                content()
            }
        }
    }

    @ViewBuilder private func banner(_ flags: FlagsView) -> some View {
        section("patient.flags") {
            if !flags.hasFlags {
                muted("patient.flags.none")
            } else if flags.detailsHidden {
                Text(String(format: String(localized: "patient.flags.counts"), Int(flags.allergyCount), Int(flags.conditionCount)))
                    .skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
                muted("patient.flags.hidden")
            } else {
                ForEach(Array(flags.allergies.enumerated()), id: \.offset) { index, allergy in
                    if index > 0 { SkDivider() }
                    SkListRow(allergy.substance, subtitle: allergy.reaction) {
                        EmptyView()
                    } trailing: {
                        SkChip(allergy.severity.label, tone: allergy.severity.tone)
                    }
                }
                ForEach(Array(flags.conditions.enumerated()), id: \.offset) { _, condition in
                    SkListRow(condition)
                }
            }
        }
    }
}
