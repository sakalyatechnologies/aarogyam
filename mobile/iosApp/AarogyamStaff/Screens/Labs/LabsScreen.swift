import AarogyamShared
import SakalyaUI
import SwiftUI

/// Lab work: cases (with an overdue filter) and the lab directory, on the shared `LabsStateHolder`.
struct LabsScreen: View {
    let holder: LabsStateHolder
    let state: LabsState
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var page = 0
    @State private var open: LabCase?
    @State private var creating = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !state.allowed {
                    SkEmptyState(pv("pv.labs.title"), message: pv("pv.labs.not_allowed"))
                } else {
                    SkSegmented([pv("pv.labs.cases"), pv("pv.labs.directory")], selectedIndex: page) { page = $0 }
                    if let error = state.error { Text(error.message).v7Text(12.5).foregroundStyle(r.error.color) }
                    if page == 0 { cases } else { LabDirectory(labs: state.labs) }
                }
            }
            .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(pv("pv.labs.title"))
        .refreshable { holder.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if state.canWrite {
                    Button { creating = true } label: { Label { Text(pv("pv.labs.new")) } icon: { V7Icon(name: "plus") } }
                }
            }
        }
        .sheet(item: $open) { LabCaseSheet(holder: holder, caseId: $0.id, state: state, zone: clinic.session.clinic.timezone) }
        .sheet(isPresented: $creating) { NewLabCaseFlow(graph: graph, clinic: clinic, labs: state.labs, onCreated: holder.refresh) }
    }

    @ViewBuilder private var cases: some View {
        let today = LabFormat.today(zone: clinic.session.clinic.timezone)
        V7ChipRow {
            SkChoiceChip(pv("pv.labs.all"), selected: !state.overdueOnly) { holder.showOverdue(only: false) }
            SkChoiceChip(pv("pv.labs.overdue"), selected: state.overdueOnly) { holder.showOverdue(only: true) }
        }
        if state.loading && state.cases.isEmpty {
            SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xl)
        } else if state.cases.isEmpty {
            V7Card { V7Muted(state.overdueOnly ? pv("pv.labs.none_overdue") : pv("pv.labs.none")).frame(maxWidth: .infinity) }
        }
        VStack(spacing: 3) {
            ForEach(Array(state.cases.enumerated()), id: \.element.id) { index, item in
                Button { open = item } label: {
                    V7ListSurface(index: index, count: state.cases.count) { LabCaseRow(item: item, overdue: LabFormat.isOverdue(dueOn: item.dueOn, today: today)) }
                }
                .buttonStyle(.skPressable)
            }
        }
    }
}

extension LabCase: @retroactive Identifiable {}

/// One case: the flask in a tonal circle, its title and detail, and the status pill.
struct LabCaseRow: View {
    let item: LabCase
    let overdue: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let pill = item.status.pill(overdue: overdue)
        HStack(spacing: 12) {
            V7Icon(name: "flask", size: 18, tint: r.onPrimaryContainer.color)
                .frame(width: 36, height: 36).background(r.primaryContainer.color, in: Circle()).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.titleText).v7Text(13.5, .bold).foregroundStyle(r.onSurface.color)
                Text(item.patientName).v7Text(12).foregroundStyle(r.onSurface.color)
                Text(item.detailText).v7Text(11.5).foregroundStyle(r.onSurfaceVariant.color)
            }
            Spacer(minLength: 4)
            V7Pill(text: pill.text, kind: pill.kind)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The directory: each lab with its number and the people there, each a tap from a call or a WhatsApp message.
struct LabDirectory: View {
    let labs: [LabRow]
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let r = theme.roles
        if labs.isEmpty { V7Card { V7Muted(pv("pv.labs.no_labs")).frame(maxWidth: .infinity) } }
        ForEach(labs, id: \.id) { lab in
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(lab.name).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                        Spacer()
                        callButton(lab.phone)
                    }
                    ForEach(lab.contacts, id: \.id) { person in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(person.name).v7Text(13).foregroundStyle(r.onSurface.color)
                                if let phone = person.phone { Text(phone).v7Text(11.5).foregroundStyle(r.onSurfaceVariant.color) }
                            }
                            Spacer()
                            if person.whatsapp { chatButton(person.phone, label: person.name) }
                            callButton(person.phone)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func callButton(_ phone: String?) -> some View {
        if let url = PatientLinks.tel(phone) {
            Button { openURL(url) } label: { V7Icon(name: "phone", size: 18, tint: theme.roles.primary.color).frame(width: 44, height: 44) }
                .accessibilityLabel(pv("pv.action.call"))
        }
    }

    @ViewBuilder private func chatButton(_ phone: String?, label: String) -> some View {
        if let url = PatientLinks.whatsApp(phone, message: pv("pv.lab.wa.hello")) {
            Button { openURL(url) } label: { V7Icon(name: "wa", size: 18, tint: theme.roles.primary.color).frame(width: 44, height: 44) }
                .accessibilityLabel(pv("pv.action.whatsapp") + ", " + label)
        }
    }
}
