import SakalyaUI
import SwiftUI

// Content pieces of the Clear Glass redesign: calm, solid inset-grouped cards (never glass) with
// hairline separators, and the small uppercase section headers above them.

/// A section heading over a grouped card (`.h-sec`): small, bold, uppercase, muted.
struct GroupedHeader: View {
    let text: String
    var trailing: String?
    @Environment(\.skTheme) private var theme

    init(_ text: String, trailing: String? = nil) {
        self.text = text
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.footnote.weight(.bold)).tracking(0.6).textCase(.uppercase)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if let trailing { Text(trailing).font(.footnote) }
        }
        .foregroundStyle(theme.roles.onSurfaceVariant.color)
        .padding(.horizontal, 4).padding(.top, 18).padding(.bottom, 8)
    }
}

/// An inset-grouped card on the solid card colour with 24-point continuous corners.
struct GroupedCard<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.card.color, in: RoundedRectangle(cornerRadius: GroupedSizes.radius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: GroupedSizes.radius, style: .continuous))
    }
}

/// The hairline between two rows of a grouped card, indented past the leading avatar or tile.
struct GroupedDivider: View {
    var inset: CGFloat = GroupedSizes.rowInset
    @Environment(\.skTheme) private var theme

    var body: some View {
        Rectangle().fill(theme.roles.outline.color.opacity(0.35)).frame(height: 0.5)
            .padding(.leading, inset).accessibilityHidden(true)
    }
}

/// `items` as rows of one grouped card, with a hairline between neighbours.
struct GroupedRows<Item, Row: View>: View {
    let items: [Item]
    var inset: CGFloat = GroupedSizes.rowInset
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        GroupedCard {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 { GroupedDivider(inset: inset) }
                row(item)
            }
        }
    }
}

enum GroupedSizes {
    static let radius: CGFloat = 24
    /// Text starts here in a row led by a 40-point avatar: 14 padding + 40 + 12 gap.
    static let rowInset: CGFloat = 66
    static let rowPaddingH: CGFloat = 14
    static let rowPaddingV: CGFloat = 9
}

/// The initials circle of the Clear Glass lists: one of four calm tones picked from the name, so
/// a person keeps the same colour everywhere (sum of the scalars, not `hashValue`).
struct GroupedAvatar: View {
    let name: String
    var initials: String?
    @Environment(\.skTheme) private var theme
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 40

    var body: some View {
        let r = theme.roles
        let (fill, ink): (Color, Color) = switch GroupedAvatar.tone(name) {
        case 0: (r.primaryContainer.color, r.onPrimaryContainer.color)
        case 1: (r.tertiaryContainer.color, r.onTertiaryContainer.color)
        case 2: (r.chart3.color.opacity(0.22), r.onSurface.color)
        default: (r.error.color.opacity(0.16), r.onSurface.color)
        }
        Text(initials ?? Initials.of(name))
            .font(.system(size: min(size, 60) * 0.35, weight: .bold))
            .foregroundStyle(ink)
            .frame(width: min(size, 60), height: min(size, 60))
            .background(fill, in: Circle())
            .accessibilityHidden(true)
    }

    static func tone(_ name: String) -> Int {
        name.unicodeScalars.reduce(0) { ($0 + Int($1.value)) % 4 }
    }
}
