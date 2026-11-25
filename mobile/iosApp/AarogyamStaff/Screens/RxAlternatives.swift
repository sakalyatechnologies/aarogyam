import AarogyamShared
import SakalyaUI
import SwiftUI

/// The alternatives of one medicine line: loading, the list (tap one to swap), none, or an error.
struct RxAlternativesList: View {
    let alternatives: AlternativesState
    let onSwap: (DrugView) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if alternatives.loading {
                note(Text("rx.alt.loading"))
            } else if let error = alternatives.error {
                note(Text(error.message), color: theme.roles.error.color)
            } else if alternatives.items.isEmpty {
                note(Text("rx.alt.none"))
            } else {
                ForEach(alternatives.items, id: \.id) { drug in
                    Button { onSwap(drug) } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(drug.brand ?? drug.name).font(.system(size: 14, weight: .bold))
                                .foregroundStyle(theme.roles.onSurface.color)
                            Text(drug.subtitleText).font(.system(size: 12))
                                .foregroundStyle(theme.roles.onSurfaceVariant.color)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.skPressable)
                }
            }
        }
    }

    private func note(_ text: Text, color: Color? = nil) -> some View {
        text.font(.system(size: 12.5)).foregroundStyle(color ?? theme.roles.onSurfaceVariant.color)
    }
}
