import AarogyamShared
import SakalyaUI
import SwiftUI

/// Patients (Clear Glass): the large title with the system search field (glass on iOS 26), glass filter
/// chips, and one calm grouped card of patients.
struct PatientsScreen: View {
    let holder: PatientsStateHolder
    let state: PatientsState
    let onOpen: (String) -> Void
    @State private var text = ""
    @State private var filter = PatientFilter.all
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(String(localized: "patients.not_allowed.title"), message: String(localized: "patients.not_allowed.message"))
                } else {
                    V7ChipRow {
                        ForEach(PatientFilter.allCases, id: \.self) { item in
                            GlassChip(text: item.title, selected: filter == item) { filter = item }
                        }
                    }
                    .padding(.top, 4)
                    if filter.needsServer { PreviewNotice().padding(.top, SkSpacing.s) }
                    content.padding(.top, SkSpacing.m)
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { holder.retry() }
        .background(theme.roles.background.color)
        .navigationTitle(String(localized: "patients.title"))
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: pv("pv.patients.search"))
        .onChange(of: text) { _, new in holder.search(text: new) }
        .skSoftScrollEdge()
        #if DEBUG && AARO_ENV_Local
        .onChange(of: openFirst) { _, id in if DevLaunch.openFirstPatient, let id { onOpen(id) } }
        #endif
    }

    private var openFirst: String? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded.items.first?.id } else { nil }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .notAllowed:
            EmptyView()
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .failed(let failed):
            SkEmptyState(String(localized: "patients.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.retry)
        case .loaded(let loaded):
            results(filter.apply(loaded.items), searched: !loaded.query.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    @ViewBuilder private func results(_ rows: [PatientRow], searched: Bool) -> some View {
        if rows.isEmpty {
            let key = searched ? "pv.patients.empty.search" : filter == .recalls ? "pv.patients.empty.recalls" : "pv.patients.empty.none"
            V7Card { Text(pv(String.LocalizationValue(key))).font(.subheadline).foregroundStyle(theme.roles.onSurfaceVariant.color) }
        } else {
            GroupedRows(items: rows) { row in
                Button { onOpen(row.id) } label: { PatientListRow(row: row) }
                    .buttonStyle(GroupedRowStyle())
            }
        }
    }
}

/// One patient (Clear Glass): a toned initials circle, name, `file · age sex`, and a recall pill or the chevron.
struct PatientListRow: View {
    let row: PatientRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 12) {
            GroupedAvatar(name: row.name)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name).font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color).lineLimit(1)
                Text(row.subtitleText).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color).lineLimit(1)
            }
            Spacer(minLength: 4)
            if row.recallDue {
                GroupedPill(text: pv("pv.patients.recall"), kind: .warm)
            } else {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(r.onSurfaceVariant.color)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
