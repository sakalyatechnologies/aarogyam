import SakalyaUI
import SwiftUI

// "Clear Glass" (redesign A): Liquid Glass on chrome only (sheets, toolbars, primary buttons,
// search, filters), calm solid surfaces for content. Every iOS 26 branch lives here, with the
// iOS 17 fallback beside it; Reduce Transparency always gets the opaque surface.

/// A glass background in `shape`; `.ultraThinMaterial` before iOS 26, `surface1` with Reduce Transparency.
private struct SkGlassBackground<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduce
    @Environment(\.skTheme) private var theme

    func body(content: Content) -> some View {
        if reduce {
            content.background(theme.roles.surface1.color, in: shape)
        } else if #available(iOS 26, *) {
            content.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            content.background(.ultraThinMaterial, in: shape)
        }
    }
}

/// A glass button (`.glass` / `.glassProminent` on iOS 26, bordered before), tinted with the primary role.
private struct SkGlassButton: ViewModifier {
    let prominent: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduce
    @Environment(\.skTheme) private var theme

    func body(content: Content) -> some View {
        Group {
            if #available(iOS 26, *), !reduce {
                if prominent { content.buttonStyle(.glassProminent) } else { content.buttonStyle(.glass) }
            } else {
                if prominent { content.buttonStyle(.borderedProminent) } else { content.buttonStyle(.bordered) }
            }
        }
        .buttonBorderShape(.capsule)
        .tint(prominent ? theme.roles.primary.color : nil)
    }
}

/// A presented sheet: the system glass sheet on iOS 26, thin material before, opaque with Reduce Transparency.
private struct SkGlassSheet: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduce
    @Environment(\.skTheme) private var theme

    func body(content: Content) -> some View {
        let sized = content.presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        if reduce {
            sized.presentationBackground(theme.roles.surface1.color)
        } else if #available(iOS 26, *) {
            sized
        } else {
            sized.presentationBackground(.ultraThinMaterial)
        }
    }
}

/// Content fades softly under the toolbar on iOS 26; earlier systems keep their bar.
private struct SkSoftScrollEdge: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.scrollEdgeEffectStyle(.soft, for: .top)
        } else {
            content
        }
    }
}

extension View {
    /// Glass behind this view in `shape`. For chrome only: never on list rows or content cards.
    func skGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        modifier(SkGlassBackground(shape: shape, interactive: interactive))
    }

    /// A capsule glass button; `prominent` fills it with the primary colour.
    func skGlassButton(prominent: Bool = false) -> some View { modifier(SkGlassButton(prominent: prominent)) }

    /// The Clear Glass sheet look (medium and large detents, grab handle).
    func skGlassSheet() -> some View { modifier(SkGlassSheet()) }

    /// A soft scroll edge under the navigation bar on iOS 26.
    func skSoftScrollEdge() -> some View { modifier(SkSoftScrollEdge()) }
}
