import AarogyamShared
import SakalyaUI
import SwiftUI

/// Sizes measured from the mock-up's `.ios` rules with the v7.2 overrides.
enum TodaySizes {
    static let cardRadius: CGFloat = 26
    static let heroRadius: CGFloat = 24
    static let iconWell: CGFloat = 36
    static let listShape: CGFloat = 36
    static let carouselCard: CGFloat = 136
    static let carouselFirst: CGFloat = 164
    static let carouselRadius: CGFloat = 20
}

/// The two initials of a name, for the round avatars in lists and the carousel.
enum Initials {
    static func of(_ name: String) -> String {
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        return String(letters).uppercased()
    }
}

/// A round initials avatar: warm (tertiary container) or cool (primary container).
struct InitialsAvatar: View {
    let name: String
    var size: CGFloat = 36
    var cool = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Text(Initials.of(name))
            .font(.system(size: size * 0.32, weight: .heavy))
            .foregroundStyle((cool ? r.onPrimaryContainer : r.onTertiaryContainer).color)
            .frame(width: size, height: size)
            .background((cool ? r.primaryContainer : r.tertiaryContainer).color, in: Circle())
            .accessibilityHidden(true)
    }
}

/// A section heading with an optional action on the right (`.sec-h`).
struct TodaySectionHeader: View {
    let title: String
    var action: String?
    var onAction: () -> Void = {}
    @Environment(\.skTheme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(size: 14.5, weight: .heavy)).foregroundStyle(theme.roles.onSurface.color)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: SkSpacing.s)
            if let action {
                Button(action: onAction) {
                    Text(action).font(.system(size: 12.5, weight: .bold)).foregroundStyle(theme.roles.primary.color)
                        .padding(SkSpacing.xs)
                }
            }
        }
        .padding(.horizontal, 2)
        .padding(.top, 16)
        .padding(.bottom, 7)
    }
}

/// One status pill (`.pill`): done, in chair, waiting, missed or booked.
struct StatusPill: View {
    let pill: TodayV7.Pill
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let (bg, ink): (SkRGB, SkRGB) = switch pill {
        case .done: (r.primaryContainer, r.onPrimaryContainer)
        case .inChair, .waiting: (r.tertiaryContainer, r.onTertiaryContainer)
        case .missed: (r.errorContainer, r.onErrorContainer)
        case .booked: (r.surface3, r.onSurfaceVariant)
        }
        Text(pill.label.uppercased()).skTextStyle(SkTypeScale.chip).foregroundStyle(ink.color).lineLimit(1)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(bg.color, in: Capsule())
    }
}

/// The row background of a joined list: round outer ends, tight corners between rows.
struct JoinedRow<Content: View>: View {
    let index: Int
    let count: Int
    let action: () -> Void
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) { content }
                .padding(.horizontal, 11).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.roles.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: count), style: .continuous))
        }
        .buttonStyle(.skPressable)
    }
}

/// Chips that wrap onto more lines when they do not fit (the me card's chip row).
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: maxX, height: y + rowHeight), origins)
    }
}
