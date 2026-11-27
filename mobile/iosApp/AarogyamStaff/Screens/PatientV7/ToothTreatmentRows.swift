import AarogyamShared
import SakalyaUI
import SwiftUI

/// The tooth's planned and done treatments; tapping a planned one's status chip marks it done.
struct ToothTreatmentRows: View {
    let sheet: ToothSheetStateHolder
    let canRecord: Bool
    @State private var rows = ToothTreatmentsState(items: [], busy: nil, error: nil)
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if !rows.items.isEmpty {
                V7Card {
                    VStack(alignment: .leading, spacing: 8) {
                        V7Label(text: pv("pv.tooth.treatments"))
                        ForEach(rows.items, id: \.id) { item in
                            HStack {
                                Text(([item.name] + (item.surfaces.isEmpty ? [] : [item.surfaces.joined()])).joined(separator: " · "))
                                    .v7Text(14, .semibold).foregroundStyle(theme.roles.onSurface.color)
                                Spacer(minLength: 8)
                                SkChoiceChip(item.done ? pv("pv.status.completed") : pv("pv.status.planned"), selected: item.done) {
                                    if !item.done && canRecord { sheet.completeTreatment(id: item.id) }
                                }
                            }
                        }
                        if let error = rows.error { Text(error.message).v7Text(12.5).foregroundStyle(theme.roles.error.color) }
                    }
                }
            }
        }
        .task { for await next in sheet.treatmentRows { rows = next } }
    }
}

/// A collapsed "More details" row; the content shows when it is open.
struct ToothMoreDetails<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var open = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { open.toggle() } label: {
                HStack {
                    Text(pv("pv.tooth.more")).v7Text(13, .bold).foregroundStyle(theme.roles.primary.color)
                    Spacer()
                    V7Icon(name: "chev", size: 16, tint: theme.roles.primary.color).rotationEffect(.degrees(open ? 270 : 90))
                }
                .frame(minHeight: 44)
            }
            .accessibilityAddTraits(.isButton)
            if open { content }
        }
    }
}
