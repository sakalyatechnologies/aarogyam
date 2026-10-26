import AarogyamShared
import SakalyaUI
import SwiftUI

/// One layer ready to draw: its path in the art's coordinates and that path's box.
struct PreparedLayer {
    let layer: ArtLayer
    let path: Path
    let box: CGRect
}

/// A whole picture ready to draw, with the shared box of each loop group.
struct PreparedArt {
    let viewBox: CGRect
    let layers: [PreparedLayer]
    let nodeBoxes: [Int32: CGRect]
    let rootLoops: [String]

    var animated: Bool { !rootLoops.isEmpty || layers.contains { !$0.layer.loops.isEmpty } }
}

/// Parses each picture's paths once; the Kotlin catalogue keeps its pieces alive, so their identity is stable.
@MainActor
enum ArtCache {
    private static var prepared: [ObjectIdentifier: (piece: ArtPiece, art: PreparedArt)] = [:]

    static func art(_ piece: ArtPiece) -> PreparedArt {
        if let hit = prepared[ObjectIdentifier(piece)] { return hit.art }
        let art = prepare(piece)
        prepared[ObjectIdentifier(piece)] = (piece, art)
        return art
    }

    private static func prepare(_ piece: ArtPiece) -> PreparedArt {
        let vb = piece.viewBox.map(\.doubleValue)
        var layers: [PreparedLayer] = []
        var boxes: [Int32: CGRect] = [:]
        for layer in piece.layers {
            guard let data = layer.pathData() else { continue }
            let path = swiftPath(data.encoded())
            let box = path.boundingRect
            layers.append(PreparedLayer(layer: layer, path: path, box: box))
            for loop in layer.loops { boxes[loop.node] = boxes[loop.node].map { $0.union(box) } ?? box }
        }
        let viewBox = vb.count == 4 ? CGRect(x: vb[0], y: vb[1], width: vb[2], height: vb[3]) : CGRect(x: 0, y: 0, width: 24, height: 24)
        return PreparedArt(viewBox: viewBox, layers: layers, nodeBoxes: boxes, rootLoops: piece.loops)
    }

    /// Encoded commands (0 move, 1 line, 2 cubic, 3 close) as a SwiftUI path, untransformed.
    static func swiftPath(_ encoded: EncodedPath) -> Path {
        let c = encoded.coords.map(\.doubleValue)
        var path = Path()
        var i = 0
        func p(_ k: Int) -> CGPoint { CGPoint(x: c[k], y: c[k + 1]) }
        for op in encoded.ops.map(\.intValue) {
            switch op {
            case 0: path.move(to: p(i)); i += 2
            case 1: path.addLine(to: p(i)); i += 2
            case 2: path.addCurve(to: p(i + 4), control1: p(i), control2: p(i + 2)); i += 6
            default: path.closeSubpath()
            }
        }
        return path
    }
}

/// Draws a picture from the shared art catalogue (avatar, illustration) with its gradients, theme
/// colours and loops (blink, bob, rock...). Under Reduce Motion it stays still.
struct ArtView: View {
    let piece: ArtPiece
    var tint: Color = .primary
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let art = ArtCache.art(piece)
        Group {
            if art.animated, !reduceMotion {
                TimelineView(.animation) { context in
                    canvas(art, ms: context.date.timeIntervalSinceReferenceDate * 1000)
                }
            } else {
                canvas(art, ms: nil)
            }
        }
        .accessibilityHidden(true)
    }

    private func canvas(_ art: PreparedArt, ms: Double?) -> some View {
        let roles = theme.roles
        return Canvas { ctx, size in
            ArtPainter(art: art, roles: roles, tint: tint, ms: ms).draw(in: &ctx, size: size)
        }
    }
}

/// The drawing itself, kept apart from the view so it can be unit-tested for its transforms.
struct ArtPainter {
    let art: PreparedArt
    let roles: SkRoles
    let tint: Color
    let ms: Double?

    func draw(in ctx: inout GraphicsContext, size: CGSize) {
        let vb = art.viewBox
        let s = min(size.width / vb.width, size.height / vb.height)
        ctx.translateBy(x: (size.width - vb.width * s) / 2 - vb.minX * s, y: (size.height - vb.height * s) / 2 - vb.minY * s)
        ctx.scaleBy(x: s, y: s)
        if let ms, !art.rootLoops.isEmpty {
            for name in art.rootLoops { apply(name, box: vb, ms: ms, to: &ctx) }
        }
        for item in art.layers {
            var c = ctx
            c.opacity = item.layer.opacity
            if let ms {
                for loop in item.layer.loops.reversed() {
                    apply(loop.kind, box: art.nodeBoxes[loop.node] ?? item.box, ms: ms, to: &c)
                }
            }
            if let fill = shading(item.layer.fill, box: item.box) {
                fill.apply(item.path, &c)
            }
            if let stroke = shading(item.layer.stroke, box: item.box) {
                let style = StrokeStyle(
                    lineWidth: item.layer.strokeWidth,
                    lineCap: item.layer.roundCaps ? .round : .butt,
                    lineJoin: item.layer.roundJoins ? .round : .miter
                )
                stroke.stroke(item.path, style, &c)
            }
        }
    }

    /// A loop's frame at `ms`, around its pivot on `box`, added to `ctx`.
    func apply(_ kind: String, box: CGRect, ms: Double, to ctx: inout GraphicsContext) {
        guard let (loop, offset) = ArtLoops.loop(kind) else { return }
        let f = loop.sample(ms + offset)
        let pivot: CGPoint =
            switch loop.pivot {
            case .top: CGPoint(x: box.midX, y: box.minY)
            case .bottom: CGPoint(x: box.midX, y: box.maxY)
            default: CGPoint(x: box.midX, y: box.midY)
            }
        ctx.translateBy(x: pivot.x + f.dx, y: pivot.y + f.dy)
        ctx.rotate(by: .degrees(f.rotation))
        ctx.scaleBy(x: f.scaleX, y: f.scaleY)
        ctx.translateBy(x: -pivot.x, y: -pivot.y)
        ctx.opacity *= f.alpha
    }

    /// How to paint a layer, or nil for none.
    func shading(_ paint: ArtPaint, box: CGRect) -> ArtShading? {
        if let solid = paint as? ArtPaintSolid { return .solid(color(solid.color)) }
        if let g = paint as? ArtPaintLinear {
            return .linear(gradient(g.stops), CGPoint(x: g.x1, y: g.y1), CGPoint(x: g.x2, y: g.y2), g.boxUnits ? box : nil)
        }
        if let g = paint as? ArtPaintRadial {
            return .radial(gradient(g.stops), CGPoint(x: g.cx, y: g.cy), g.r, g.boxUnits ? box : nil)
        }
        return nil
    }

    func color(_ c: ArtColor) -> Color {
        if let fixed = c as? ArtColorFixed { return (SkRGB(hex: fixed.hex)?.color ?? .black).opacity(fixed.alpha) }
        if let role = c as? ArtColorRole { return roles.named(role.name)?.color ?? tint }
        return tint
    }

    private func gradient(_ stops: [ArtStop]) -> Gradient {
        Gradient(stops: stops.map { Gradient.Stop(color: color($0.color).opacity($0.opacity), location: $0.offset) })
    }
}

/// A resolved paint: solid, or a gradient in the art's space, or in its layer's box (`box`).
enum ArtShading {
    case solid(Color)
    case linear(Gradient, CGPoint, CGPoint, CGRect?)
    case radial(Gradient, CGPoint, Double, CGRect?)

    func apply(_ path: Path, _ ctx: inout GraphicsContext) {
        switch self {
        case .solid(let color):
            ctx.fill(path, with: .color(color))
        default:
            var c = ctx
            c.clip(to: path)
            paintGradient(&c, bounds: path.boundingRect)
        }
    }

    func stroke(_ path: Path, _ style: StrokeStyle, _ ctx: inout GraphicsContext) {
        switch self {
        case .solid(let color):
            ctx.stroke(path, with: .color(color), style: style)
        default:
            let outline = path.strokedPath(style)
            var c = ctx
            c.clip(to: outline)
            paintGradient(&c, bounds: outline.boundingRect)
        }
    }

    /// Fills `bounds` with the gradient; box units are drawn in the box's own unit square, as SVG does.
    private func paintGradient(_ c: inout GraphicsContext, bounds: CGRect) {
        switch self {
        case .solid: break
        case .linear(let g, let from, let to, let box):
            if let box {
                c.concatenate(CGAffineTransform(a: box.width, b: 0, c: 0, d: box.height, tx: box.minX, ty: box.minY))
                c.fill(Path(CGRect(x: 0, y: 0, width: 1, height: 1)), with: .linearGradient(g, startPoint: from, endPoint: to))
            } else {
                c.fill(Path(bounds), with: .linearGradient(g, startPoint: from, endPoint: to))
            }
        case .radial(let g, let center, let r, let box):
            if let box {
                c.concatenate(CGAffineTransform(a: box.width, b: 0, c: 0, d: box.height, tx: box.minX, ty: box.minY))
                c.fill(Path(CGRect(x: 0, y: 0, width: 1, height: 1)), with: .radialGradient(g, center: center, startRadius: 0, endRadius: r))
            } else {
                c.fill(Path(bounds), with: .radialGradient(g, center: center, startRadius: 0, endRadius: r))
            }
        }
    }
}

/// The catalogue's loop names, mapped to the kit's loop tokens (with the second sparkle's offset).
enum ArtLoops {
    static func loop(_ kind: String) -> (SkLoop, Double)? {
        switch kind {
        case "bob": (SkLoopTokens.bob, 0)
        case "blink": (SkLoopTokens.blink, 0)
        case "glow": (SkLoopTokens.glow, 0)
        case "float": (SkLoopTokens.float, 0)
        case "rock": (SkLoopTokens.rock, 0)
        case "twinkle": (SkLoopTokens.twinkle, 0)
        case "twinkle2": (SkLoopTokens.twinkle, SkLoopTokens.twinkleOffsetMs)
        case "spin": (SkLoopTokens.spin, 0)
        default: nil
        }
    }
}

/// A v7 line icon by its catalogue name, in the text colour.
struct V7Icon: View {
    let name: String
    var size: CGFloat = 22
    var tint: Color? = nil
    var label: String? = nil
    @Environment(\.skTheme) private var theme

    var body: some View {
        if let path = V7Icon.path(name) {
            SkIcon(path, tint: tint ?? theme.roles.onSurface.color, size: size, label: label)
        }
    }

    @MainActor private static var cache: [String: SkPath] = [:]

    @MainActor static func path(_ name: String) -> SkPath? {
        if let hit = cache[name] { return hit }
        let e = Icons.shared.of(name: name).encoded()
        let made = SkPath(ops: e.ops.map(\.intValue), coords: e.coords.map(\.doubleValue), viewBox: CGRect(x: 0, y: 0, width: 24, height: 24))
        cache[name] = made
        return made
    }
}

extension V7Icon {
    /// The icon as a template image for system bars (tab items, toolbar labels), stroked 2 points.
    @MainActor static func image(_ name: String, size: CGFloat = 24) -> Image {
        guard let path = path(name) else { return Image(systemName: "circle") }
        let renderer = ImageRenderer(content: SkIcon(path, tint: .black, size: size))
        renderer.scale = 3
        guard let ui = renderer.uiImage else { return Image(systemName: "circle") }
        return Image(uiImage: ui.withRenderingMode(.alwaysTemplate))
    }
}
