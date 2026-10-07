import AarogyamShared
import SakalyaUI
import SwiftUI

/// Both arches of one dentition, left to right as the clinician faces the patient. A tap picks a
/// tooth; once pinched in, a tap on a crown also picks that surface. Mirrors Android's `ToothChart`.
struct ToothChartView: View {
    let upper: [ToothView]
    let lower: [ToothView]
    let selected: Int32?
    var group: [Int32] = []
    let selectedSurface: Surface?
    @Binding var scale: CGFloat
    let onSelect: (Int32, Surface?) -> Void
    @State private var offset: CGSize = .zero
    @State private var pinchStart: CGFloat?
    @State private var dragStart: CGSize?
    @Environment(\.skTheme) private var theme

    static let maxZoom: CGFloat = 4
    private var zoomed: Bool { scale > 1.5 }

    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: SkSpacing.xs) {
                archLabel("chart.upper")
                arch(upper)
                archLabel("chart.lower")
                arch(lower)
            }
            .scaleEffect(scale)
            .offset(offset)
            .frame(width: proxy.size.width, height: proxy.size.height)
            .contentShape(Rectangle())
            .simultaneousGesture(pinch(proxy.size))
            .gesture(pan(proxy.size), including: scale > 1 ? .all : .subviews)
        }
        .frame(height: Self.height)
        .clipped()
        .onChange(of: scale) { _, new in if new <= 1 { offset = .zero } }
    }

    private func archLabel(_ key: String.LocalizationValue) -> some View {
        Text(String(localized: key, table: "Chart")).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
    }

    private func arch(_ teeth: [ToothView]) -> some View {
        let total = teeth.reduce(0) { $0 + $1.kind.weight }
        return GeometryReader { proxy in
            let gaps = CGFloat(max(teeth.count - 1, 0)) * Self.gap
            HStack(spacing: Self.gap) {
                ForEach(teeth, id: \.number) { tooth in
                    ToothCell(
                        tooth: tooth,
                        selected: tooth.number == selected || group.contains(tooth.number),
                        selectedSurface: tooth.number == selected ? selectedSurface : nil,
                        zoomed: zoomed,
                        onSelect: { onSelect(tooth.number, $0) }
                    )
                    .frame(width: (proxy.size.width - gaps) * tooth.kind.weight / total)
                }
            }
        }
        .frame(height: Self.toothHeight + Self.numberHeight)
    }

    private func pinch(_ size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = pinchStart ?? scale
                pinchStart = start
                scale = min(max(start * value.magnification, 1), Self.maxZoom)
                offset = clamp(offset, size)
            }
            .onEnded { _ in pinchStart = nil }
    }

    private func pan(_ size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                let start = dragStart ?? offset
                dragStart = start
                offset = clamp(CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height), size)
            }
            .onEnded { _ in dragStart = nil }
    }

    private func clamp(_ proposed: CGSize, _ size: CGSize) -> CGSize {
        let maxX = size.width * (scale - 1) / 2
        let maxY = size.height * (scale - 1) / 2
        return CGSize(width: min(max(proposed.width, -maxX), maxX), height: min(max(proposed.height, -maxY), maxY))
    }

    static let gap: CGFloat = 2
    static let toothHeight: CGFloat = 58
    static let numberHeight: CGFloat = 12
    static let height: CGFloat = 2 * (toothHeight + numberHeight) + 48
}

private struct ToothCell: View {
    let tooth: ToothView
    let selected: Bool
    let selectedSurface: Surface?
    let zoomed: Bool
    let onSelect: (Surface?) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        VStack(spacing: 0) {
            if tooth.upper { number(p) }
            GeometryReader { proxy in
                Canvas { context, size in
                    ToothPainter(tooth: tooth, palette: p, selected: selected, selectedSurface: selectedSurface)
                        .draw(in: &context, geometry: ToothGeometry(tooth: tooth, size: size))
                }
                .contentShape(Rectangle())
                .onTapGesture(coordinateSpace: .local) { point in
                    onSelect(zoomed ? ToothGeometry(tooth: tooth, size: proxy.size).surface(at: point) : nil)
                }
            }
            .frame(height: ToothChartView.toothHeight)
            if !tooth.upper { number(p) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tooth.accessibilityText)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction { onSelect(nil) }
    }

    private func number(_ p: SkPalette) -> some View {
        Text("\(tooth.number)")
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(selected ? p.primary.color : tooth.needsCare ? p.text.color : p.textMuted.color)
            .frame(height: ToothChartView.numberHeight)
    }
}
