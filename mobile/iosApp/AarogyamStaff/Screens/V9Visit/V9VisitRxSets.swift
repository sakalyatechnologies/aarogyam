import AarogyamShared
import SakalyaUI
import SwiftUI

/// The medicine-set chips above the search results: one tap adds every medicine of the set.
struct V9RxSetChips: View {
    let rx: RxSheetStateHolder
    let sets: [RxSetChip]
    let locked: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SkSpacing.sm) {
                ForEach(sets, id: \.id) { set in
                    Button { rx.addSet(id: set.id) } label: { chip(set) }
                        .buttonStyle(.skPressable)
                        .disabled(locked)
                }
            }
            .padding(.horizontal, 14)
        }
        .padding(.horizontal, -14)
    }

    private func chip(_ set: RxSetChip) -> some View {
        let r = theme.roles
        return HStack(spacing: 6) {
            V7Icon(name: "plus", size: 14, tint: r.onSurface.color)
            Text(set.label).v7Text(13.5, .semibold)
            Text("\(Int(set.count))").v7Text(11.5).opacity(0.7)
        }
        .foregroundStyle(r.onSurface.color).lineLimit(1)
        .padding(.horizontal, 12).frame(minHeight: SkSpacing.minTouchTarget)
        .background(r.surface3.color, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(V9f("v9v.rx.set.a11y", set.label, Int(set.count)))
    }
}
