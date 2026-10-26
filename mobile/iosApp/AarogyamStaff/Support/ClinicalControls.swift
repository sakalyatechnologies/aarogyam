import SakalyaUI
import SwiftUI

/// A choice chip with a line icon before its text (the mockup's WhatsApp chip), drawn like
/// `SkChoiceChip`: 32 points high, a pill on the surface, the primary container when chosen.
struct IconChoiceChip: View {
    let text: String
    var icon: String?
    let selected: Bool
    let action: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let ink = (selected ? r.onPrimaryContainer : r.onSurfaceVariant).color
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { V7Icon(name: icon, size: 16, tint: ink) }
                Text(text).skTextStyle(SkTypeScale.callout).lineLimit(1).foregroundStyle(ink)
            }
            .padding(.horizontal, SkControlSizes.chipPaddingH)
            .frame(minHeight: SkControlSizes.chipHeight)
            .background((selected ? r.primaryContainer : r.surface3).color, in: Capsule())
            .padding(.vertical, (SkSpacing.minTouchTarget - SkControlSizes.chipHeight) / 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.skPressable)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The soft rounded row used for lines in sheets (`.line`: surface2, 14 points round).
struct SheetLine<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        content
            .padding(.vertical, 11).padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A card in the error container, for allergy alerts and problems.
struct AlertCard<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.sm) { content }
            .foregroundStyle(theme.roles.onErrorContainer.color)
            .padding(SkSpacing.ml)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.errorContainer.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

/// Wraps its children onto new lines, like the kit's chip rows.
struct ChipFlow: Layout {
    var spacing: CGFloat = SkControlSizes.chipGap

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let laid = arrange(bounds.width, subviews)
        for (index, origin) in laid.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        var origins: [CGPoint] = []
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return (CGSize(width: widest, height: y + row), origins)
    }
}
