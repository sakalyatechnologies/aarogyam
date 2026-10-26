import AarogyamShared
import SakalyaUI
import SwiftUI

/// The mockup's fixed tooth colours (`.tooth.*`): a radial highlight, the body, the ink for the number.
struct JawPaint {
    let stops: [(Color, CGFloat)]
    let ink: Color

    private static func rgb(_ hex: UInt32) -> Color { SkRGB(hex).color }

    static func of(_ tone: JawTone) -> JawPaint {
        switch tone {
        case .plain: JawPaint(stops: [(rgb(0xFFFFFF), 0), (rgb(0xF4F1EA), 0.45), (rgb(0xDCD6C8), 1)], ink: rgb(0x5D6B64))
        case .treated: JawPaint(stops: [(rgb(0xE6FFF4), 0), (rgb(0x9BE3C3), 0.6), (rgb(0x5FBF98), 1)], ink: rgb(0x064A33))
        case .progress: JawPaint(stops: [(rgb(0xFFF2E6), 0), (rgb(0xFFC28F), 0.6), (rgb(0xE8833A), 1)], ink: rgb(0x5A2500))
        case .watch: JawPaint(stops: [(rgb(0xFFFBE6), 0), (rgb(0xFFE58A), 0.6), (rgb(0xE6BF2E), 1)], ink: rgb(0x5A4600))
        case .care: JawPaint(stops: [(rgb(0xFFEDED), 0), (rgb(0xFFB0B0), 0.6), (rgb(0xE05555), 1)], ink: rgb(0x5A0F0F))
        case .missing: JawPaint(stops: [(rgb(0xF4F1EA).opacity(0.25), 0), (rgb(0xDCD6C8).opacity(0.25), 1)], ink: rgb(0x8A948E))
        }
    }

    /// The dot beside a legend label: the body colour.
    var dot: Color { stops.count > 2 ? stops[1].0 : stops[0].0 }
}

/// Both arches of one dentition as the mockup's 2.5D jaw: teeth placed from the shared `JawGeometry`,
/// tilted back with `rotation3DEffect`, the picked tooth lifting on a spring. Reduced motion keeps it flat and still.
struct JawChart: View {
    let dentition: Dentition
    let teeth: [Int32: ToothView]
    let picked: Set<Int32>
    let onSelect: (Int32) -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let height: CGFloat = 250
    static let restingTilt: Double = 24
    static let pickedTilt: Double = 8

    var body: some View {
        let r = theme.roles
        let tilt = reduceMotion ? 0 : (picked.isEmpty ? Self.restingTilt : Self.pickedTilt)
        GeometryReader { proxy in
            let w = proxy.size.width, h = proxy.size.height
            let size = min(30, w * 0.084)
            ZStack {
                Ellipse()
                    .stroke(gum(r), lineWidth: 18)
                    .opacity(0.55)
                    .frame(width: w * 0.84, height: h * 0.92)
                    .position(x: w / 2, y: h / 2)
                ForEach(JawGeometry.shared.spots(dentition: dentition), id: \.tooth) { spot in
                    if let tooth = teeth[Int32(spot.tooth)] {
                        JawTooth(tooth: tooth, size: size, picked: picked.contains(tooth.number)) { onSelect(tooth.number) }
                            .position(x: w * spot.x, y: h * spot.y)
                            .zIndex(picked.contains(tooth.number) ? 1 : 0)
                    }
                }
                centre.position(x: w / 2, y: h / 2).allowsHitTesting(false)
            }
            .frame(width: w, height: h)
            .rotation3DEffect(.degrees(tilt), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
            .animation(reduceMotion ? nil : .spring(response: 0.8, dampingFraction: 0.7), value: tilt)
        }
        .frame(height: Self.height)
        .padding(.vertical, 4)
    }

    private var centre: some View {
        let withHistory = teeth.values.filter { $0.needsCare }.count
        return VStack(spacing: 1) {
            Text(pvf("pv.jaw.centre", withHistory)).v7Text(11, .bold)
            Text(pv("pv.jaw.tap")).v7Text(11, .medium)
        }
        .multilineTextAlignment(.center)
        .foregroundStyle(theme.roles.onSurfaceVariant.color)
    }

    /// The mockup's gum: `#f3a7a7` mixed half and half with the page.
    private func gum(_ r: SkRoles) -> Color { SkRGB(0xF3A7A7).mixed(with: r.background, weight: 0.5).color }
}

/// One tooth of the jaw: a rounded crown with a lower edge for depth, lifting when picked.
struct JawTooth: View {
    let tooth: ToothView
    let size: CGFloat
    let picked: Bool
    let onTap: () -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let tone = JawTone.of(tooth.headline)
        let paint = JawPaint.of(tone)
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: size * 0.44, bottomLeadingRadius: size * 0.48,
            bottomTrailingRadius: size * 0.48, topTrailingRadius: size * 0.44, style: .continuous
        )
        Button(action: onTap) {
            ZStack {
                shape.fill(SkRGB(0xC9C2B1).color).offset(y: size * 0.16).opacity(tone == .missing ? 0 : 1)
                shape.fill(RadialGradient(stops: paint.stops.map { .init(color: $0.0, location: $0.1) }, center: UnitPoint(x: 0.35, y: 0.3), startRadius: 0, endRadius: size * 0.8))
                if tone == .missing { shape.strokeBorder(paint.ink, style: StrokeStyle(lineWidth: 1, dash: [3, 2])) }
                Text(String(tooth.number)).font(.system(size: size * 0.32, weight: .bold, design: .monospaced)).foregroundStyle(paint.ink)
            }
            .frame(width: size, height: size)
            .overlay { if picked { shape.stroke(theme.roles.primary.color, lineWidth: 3) } }
            .shadow(color: .black.opacity(picked ? 0.45 : 0.3), radius: picked ? 9 : 5, y: picked ? 10 : 6)
            .scaleEffect(picked ? 1.22 : 1)
            .offset(y: picked ? -6 : 0)
            .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.55), value: picked)
            .padding(6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tooth.accessibilityText)
        .accessibilityAddTraits(picked ? [.isSelected, .isButton] : .isButton)
    }
}

/// The jaw's legend: a dot and a label per colour, centred.
struct JawLegend: View {
    @Environment(\.skTheme) private var theme

    var body: some View {
        V7Flow(spacing: 10) {
            ForEach([JawTone.treated, .progress, .watch, .care, .missing], id: \.self) { tone in
                HStack(spacing: 4) {
                    Circle().fill(JawPaint.of(tone).dot).frame(width: 10, height: 10)
                    Text(tone.title).v7Text(11.5).foregroundStyle(theme.roles.onSurfaceVariant.color)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The list that stands in for the jaw with VoiceOver on (and on request): every tooth, its finding, one tap to open.
struct JawList: View {
    let upper: [ToothView]
    let lower: [ToothView]
    let picked: Set<Int32>
    let onSelect: (Int32) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 3) {
            section(pv("pv.jaw.upper"), upper, r)
            section(pv("pv.jaw.lower"), lower, r)
        }
    }

    @ViewBuilder private func section(_ title: String, _ teeth: [ToothView], _ r: SkRoles) -> some View {
        Text(title).v7Text(11, .bold).foregroundStyle(r.onSurfaceVariant.color).padding(.top, 6)
        ForEach(Array(teeth.enumerated()), id: \.element.number) { index, tooth in
            Button { onSelect(tooth.number) } label: {
                V7ListSurface(index: index, count: teeth.count) {
                    HStack(spacing: 10) {
                        Circle().fill(JawPaint.of(JawTone.of(tooth.headline)).dot).frame(width: 12, height: 12)
                        Text(String(tooth.number)).v7Text(13.5, .bold).foregroundStyle(r.onSurface.color)
                        Text(tooth.headline.label).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        Spacer()
                        if picked.contains(tooth.number) { V7Icon(name: "check", size: 16, tint: r.primary.color) }
                    }
                }
            }
            .buttonStyle(.skPressable)
            .accessibilityLabel(tooth.accessibilityText)
            .accessibilityAddTraits(picked.contains(tooth.number) ? .isSelected : [])
        }
    }
}
