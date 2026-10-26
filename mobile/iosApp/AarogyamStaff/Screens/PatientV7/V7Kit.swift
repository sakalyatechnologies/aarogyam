import SakalyaUI
import SwiftUI

/// A fixed v7 size that still follows Dynamic Type.
struct V7Text: ViewModifier {
    @ScaledMetric private var size: CGFloat
    let weight: Font.Weight

    init(_ size: CGFloat, _ weight: Font.Weight) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: .body)
        self.weight = weight
    }

    func body(content: Content) -> some View { content.font(.system(size: size, weight: weight)) }
}

extension View {
    /// The mockup's point size and weight, scaled with the reader's text size.
    func v7Text(_ size: CGFloat, _ weight: Font.Weight = .regular) -> some View { modifier(V7Text(size, weight)) }
}

/// The mockup's `.pill`: 9.5 pt, heavy, uppercase, tonal. `.w` is warm, `.d` the primary container, `.n` error, `.b` neutral.
struct V7Pill: View {
    enum Kind { case warm, done, error, neutral }
    let text: String
    var kind: Kind = .warm
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let (fill, ink): (SkRGB, SkRGB) = switch kind {
        case .warm: (r.tertiaryContainer, r.onTertiaryContainer)
        case .done: (r.primaryContainer, r.onPrimaryContainer)
        case .error: (r.errorContainer, r.onErrorContainer)
        case .neutral: (r.surface3, r.onSurfaceVariant)
        }
        Text(text.uppercased())
            .v7Text(9.5, .heavy).tracking(0.4)
            .foregroundStyle(ink.color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(fill.color, in: Capsule())
            .fixedSize()
    }
}

/// The mockup's `.shape` on iOS: a circle with initials, tonal (`primaryContainer`) or warm (`tertiaryContainer`) on a counter.
struct V7Initials: View {
    let name: String
    var size: CGFloat = 36
    var strong = false
    var alternate = false
    @Environment(\.skTheme) private var theme
    @ScaledMetric private var scale: CGFloat = 1

    var body: some View {
        let r = theme.roles
        let fill = strong ? r.primary : alternate ? r.primaryContainer : r.tertiaryContainer
        let ink = strong ? r.onPrimary : alternate ? r.onPrimaryContainer : r.onTertiaryContainer
        SkAvatarFrame(shape: .circle, size: size * min(scale, 1.6), background: fill.color) {
            Text(skInitials(of: name)).font(.system(size: size * 0.32 * min(scale, 1.6), weight: .heavy)).foregroundStyle(ink.color)
        }
        .accessibilityHidden(true)
    }
}

/// A grouped list row on the card colour, rounded at the outer ends only (the mockup's `.list .li`).
struct V7ListSurface<Content: View>: View {
    let index: Int
    let count: Int
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        content
            .padding(.vertical, 10).padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: count), style: .continuous))
    }
}

/// The mockup's `.card` on iOS: card colour, 20 pt corners, 14 pt padding.
struct V7Card<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.card.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// A muted line of copy.
struct V7Muted: View {
    let text: String
    @Environment(\.skTheme) private var theme

    init(_ text: String) { self.text = text }

    var body: some View { Text(text).v7Text(12.5).foregroundStyle(theme.roles.onSurfaceVariant.color) }
}

/// A row of chips that scrolls sideways, as the mockup's `.chips` does when it overflows.
struct V7ChipRow<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) { content }.padding(.horizontal, SkSpacing.l)
        }
        .padding(.horizontal, -SkSpacing.l)
    }
}

/// Wraps its children onto new lines, as the mockup's `flex-wrap`.
struct V7Flow: Layout {
    var spacing: CGFloat = 6

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
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
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
