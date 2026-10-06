import AarogyamShared
import SakalyaUI
import SwiftUI

/// Draws one tooth: root, crown, surface findings, whole-tooth marks and the selection.
struct ToothPainter {
    let tooth: ToothView
    let palette: SkPalette
    let selected: Bool
    let selectedSurface: Surface?

    func draw(in context: inout GraphicsContext, geometry g: ToothGeometry) {
        let outline = palette.rule.color
        let highlight = palette.primary.color
        if tooth.pending { context.opacity = 0.55 }
        let whole = tooth.whole.flatMap { $0 == .sound ? nil : $0 }
        let wholePaint = whole?.paint(palette)
        if whole == .missing {
            let dashed = StrokeStyle(lineWidth: 1, dash: [3, 2])
            context.stroke(g.rootPath, with: .color(outline), style: dashed)
            context.stroke(g.crownPath, with: .color(palette.textMuted.color.opacity(0.6)), style: dashed)
            if selected { context.stroke(g.crownPath, with: .color(highlight), lineWidth: 2) }
            return
        }
        context.fill(g.rootPath, with: .color(whole == .implant ? (wholePaint?.fill ?? .clear) : outline.opacity(0.35)))
        context.stroke(g.rootPath, with: .color(outline), lineWidth: 1)
        if let wholePaint, whole == .rootCanal {
            let r = g.root
            line(&context, CGPoint(x: r.midX, y: r.minY + r.height * 0.15), CGPoint(x: r.midX, y: r.maxY - r.height * 0.15), wholePaint.ink, 2)
        }
        if let wholePaint, whole == .implant {
            let r = g.root
            for k in 1...4 {
                let y = r.minY + r.height * CGFloat(k) / 5
                line(&context, CGPoint(x: r.minX + r.width * 0.2, y: y), CGPoint(x: r.maxX - r.width * 0.2, y: y), wholePaint.ink, 1)
            }
        }
        var crown = context
        crown.clip(to: g.crownPath)
        if let wholePaint { crown.fill(Path(g.crown), with: .color(wholePaint.fill)) }
        for surface in Surface.allCases {
            guard let finding = tooth.finding(surface: surface), finding != .sound else { continue }
            var zone = crown
            zone.clip(to: g.zone(surface))
            let paint = finding.paint(palette)
            zone.fill(Path(g.crown), with: .color(paint.fill))
            Self.pattern(&zone, paint, in: g.crown)
        }
        if let wholePaint { Self.pattern(&crown, wholePaint, in: g.crown) }
        for surface in Surface.allCases { crown.stroke(g.zone(surface), with: .color(outline), lineWidth: 1) }
        if let selectedSurface { crown.stroke(g.zone(selectedSurface), with: .color(highlight), lineWidth: 2) }
        let heavy = whole == .crown
        context.stroke(g.crownPath, with: .color(heavy ? (wholePaint?.ink ?? outline) : outline), lineWidth: heavy ? 2 : 1)
        if selected { context.stroke(g.crownPath, with: .color(highlight), lineWidth: 2.5) }
    }

    private func line(_ context: inout GraphicsContext, _ from: CGPoint, _ to: CGPoint, _ color: Color, _ width: CGFloat) {
        context.stroke(Path { $0.move(to: from); $0.addLine(to: to) }, with: .color(color), lineWidth: width)
    }

    /// The finding's pattern over `box`, already clipped by the caller.
    static func pattern(_ context: inout GraphicsContext, _ paint: FindingPaint, in box: CGRect) {
        let step: CGFloat = 3
        var lines = Path()
        switch paint.pattern {
        case .none, .solid:
            return
        case .stripes, .cross:
            var x = box.minX - box.height
            while x < box.maxX {
                lines.move(to: CGPoint(x: x, y: box.maxY))
                lines.addLine(to: CGPoint(x: x + box.height, y: box.minY))
                if paint.pattern == .cross {
                    lines.move(to: CGPoint(x: x, y: box.minY))
                    lines.addLine(to: CGPoint(x: x + box.height, y: box.maxY))
                }
                x += step
            }
        case .vertical, .grid:
            var x = box.minX + step / 2
            while x < box.maxX {
                lines.move(to: CGPoint(x: x, y: box.minY))
                lines.addLine(to: CGPoint(x: x, y: box.maxY))
                x += step
            }
            if paint.pattern == .grid { horizontal(&lines, box, step) }
        case .bars:
            horizontal(&lines, box, step * 2)
        case .dots:
            var y = box.minY + step / 2
            while y < box.maxY {
                var x = box.minX + step / 2
                while x < box.maxX {
                    lines.addEllipse(in: CGRect(x: x - 0.7, y: y - 0.7, width: 1.4, height: 1.4))
                    x += step
                }
                y += step
            }
            context.fill(lines, with: .color(paint.ink))
            return
        }
        context.stroke(lines, with: .color(paint.ink), lineWidth: 0.8)
    }

    private static func horizontal(_ lines: inout Path, _ box: CGRect, _ step: CGFloat) {
        var y = box.minY + step / 2
        while y < box.maxY {
            lines.move(to: CGPoint(x: box.minX, y: y))
            lines.addLine(to: CGPoint(x: box.maxX, y: y))
            y += step
        }
    }
}

/// A small square drawn the way the chart draws `finding`.
struct FindingSwatch: View {
    let finding: Finding
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        let paint = finding.paint(p)
        Canvas { context, size in
            let box = CGRect(origin: .zero, size: size)
            context.fill(Path(box), with: .color(paint.fill))
            var clipped = context
            clipped.clip(to: Path(box))
            ToothPainter.pattern(&clipped, paint, in: box)
            let outline = finding == .crown ? paint.ink : p.rule.color
            context.stroke(Path(box), with: .color(outline), style: StrokeStyle(lineWidth: 1, dash: finding == .missing ? [2, 2] : []))
        }
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
}
