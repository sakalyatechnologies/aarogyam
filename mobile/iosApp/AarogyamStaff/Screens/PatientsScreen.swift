import AarogyamShared
import SakalyaUI
import SwiftUI

/// The v7 Patients list: search, filter chips, and a grouped list with initials in a circle and a due pill.
struct PatientsScreen: View {
    let holder: PatientsStateHolder
    let state: PatientsState
    let onOpen: (String) -> Void
    @State private var text = ""
    @State private var filter = PatientFilter.all
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                SkLargeTitleHeader(String(localized: "patients.title"))
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(String(localized: "patients.not_allowed.title"), message: String(localized: "patients.not_allowed.message"))
                } else {
                    SkSearchField(text: $text, prompt: pv("pv.patients.search"))
                        .onChange(of: text) { _, new in holder.search(text: new) }
                    V7ChipRow {
                        ForEach(PatientFilter.allCases, id: \.self) { item in
                            SkChoiceChip(item.title, selected: filter == item) { filter = item }
                        }
                    }
                    if filter.needsServer { PreviewNotice() }
                    content
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { holder.retry() }
        .background(theme.roles.background.color)
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
            V7Card { Text(pv(String.LocalizationValue(key))).v7Text(13).foregroundStyle(theme.roles.onSurfaceVariant.color) }
        } else {
            VStack(spacing: 3) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    Button { onOpen(row.id) } label: {
                        V7ListSurface(index: index, count: rows.count) { PatientListRow(row: row, alternate: index % 2 == 1) }
                    }
                    .buttonStyle(.skPressable)
                }
            }
        }
    }
}

/// One patient: initials, name, `file · age sex`, and a recall pill or the chevron.
struct PatientListRow: View {
    let row: PatientRow
    let alternate: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 12) {
            V7Initials(name: row.name, alternate: alternate)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name).v7Text(13.5, .bold).foregroundStyle(r.onSurface.color)
                Text(row.subtitleText).v7Text(11.5).foregroundStyle(r.onSurfaceVariant.color)
            }
            Spacer(minLength: 4)
            if row.recallDue { V7Pill(text: pv("pv.patients.recall")) } else { V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color) }
        }
        .accessibilityElement(children: .combine)
    }
}
