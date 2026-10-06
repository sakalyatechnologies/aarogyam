import AarogyamShared
import SakalyaUI
import SwiftUI

/// Search-as-you-type over the clinic's patients; a tap opens Patient 360.
struct PatientsScreen: View {
    let holder: PatientsStateHolder
    let state: PatientsState
    let onOpen: (String) -> Void
    @State private var text = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                SkLargeTitleHeader(String(localized: "patients.title"))
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(String(localized: "patients.not_allowed.title"), message: String(localized: "patients.not_allowed.message"))
                } else {
                    SkSearchField(text: $text, prompt: String(localized: "patients.search"))
                        .padding(.horizontal, SkSpacing.l)
                        .onChange(of: text) { _, new in holder.search(text: new) }
                    content
                }
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { holder.retry() }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .notAllowed:
            EmptyView()
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .failed(let failed):
            SkEmptyState(
                String(localized: "patients.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.retry
            )
        case .loaded(let loaded):
            results(loaded)
        }
    }

    @ViewBuilder private func results(_ loaded: PatientsStateLoaded) -> some View {
        if loaded.items.isEmpty {
            let searched = !loaded.query.trimmingCharacters(in: .whitespaces).isEmpty
            SkEmptyState(
                String(localized: searched ? "patients.empty.title" : "patients.none.title"),
                message: String(localized: searched ? "patients.empty.message" : "patients.none.message")
            )
        } else {
            SkCard(padding: SkSpacing.xs) {
                ForEach(Array(loaded.items.enumerated()), id: \.element.id) { index, row in
                    if index > 0 { SkDivider() }
                    Button { onOpen(row.id) } label: {
                        SkListRow(row.name, subtitle: row.subtitleText, showsChevron: !row.recallDue) {
                            SkAvatar(row.name)
                        } trailing: {
                            if row.recallDue { SkChip(String(localized: "recall_due"), tone: .warning) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }
}
