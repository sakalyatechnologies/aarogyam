import AarogyamShared
import SwiftUI

/// Where a tooth's parts sit in its box. Upper teeth have the root at the top, lower teeth at the
/// bottom, so both crowns face the biting plane. The buccal zone is on the root side, the lingual
/// zone on the biting side, and mesial faces the midline (the Android `ToothGeometry` twin).
struct ToothGeometry {
    private enum Side { case top, bottom, left, right }

    let crown: CGRect
    let root: CGRect
    let inner: CGRect
    private let upper: Bool
    private let mesialFacesRight: Bool
    private let molar: Bool
    private let rounded: Bool

    init(upper: Bool, mesialFacesRight: Bool, kind: ToothKind, size: CGSize) {
        self.upper = upper
        self.mesialFacesRight = mesialFacesRight
        molar = kind == .molar
        rounded = kind == .molar || kind == .premolar
        let w = size.width
        let h = size.height
        let rootH = h * Self.rootShare
        crown = upper ? CGRect(x: 0, y: rootH, width: w, height: h - rootH) : CGRect(x: 0, y: 0, width: w, height: h - rootH)
        let inset = w * Self.rootInset
        root = CGRect(x: inset, y: upper ? 0 : h - rootH, width: w - 2 * inset, height: rootH)
        inner = crown.insetBy(dx: crown.width * Self.innerShare, dy: crown.height * Self.innerShare)
    }

    init(tooth: ToothView, size: CGSize) {
        self.init(upper: tooth.upper, mesialFacesRight: tooth.mesialFacesRight, kind: tooth.kind, size: size)
    }

    private func side(of surface: Surface) -> Side? {
        switch surface {
        case .o: nil
        case .b: upper ? .top : .bottom
        case .l: upper ? .bottom : .top
        case .m: mesialFacesRight ? .right : .left
        case .d: mesialFacesRight ? .left : .right
        }
    }

    /// The zone of `surface` inside the crown.
    func zone(_ surface: Surface) -> Path {
        let c = crown
        let i = inner
        let points: [CGPoint] =
            switch side(of: surface) {
            case nil: [CGPoint(x: i.minX, y: i.minY), CGPoint(x: i.maxX, y: i.minY), CGPoint(x: i.maxX, y: i.maxY), CGPoint(x: i.minX, y: i.maxY)]
            case .top: [CGPoint(x: c.minX, y: c.minY), CGPoint(x: c.maxX, y: c.minY), CGPoint(x: i.maxX, y: i.minY), CGPoint(x: i.minX, y: i.minY)]
            case .bottom: [CGPoint(x: c.minX, y: c.maxY), CGPoint(x: c.maxX, y: c.maxY), CGPoint(x: i.maxX, y: i.maxY), CGPoint(x: i.minX, y: i.maxY)]
            case .left: [CGPoint(x: c.minX, y: c.minY), CGPoint(x: i.minX, y: i.minY), CGPoint(x: i.minX, y: i.maxY), CGPoint(x: c.minX, y: c.maxY)]
            case .right: [CGPoint(x: c.maxX, y: c.minY), CGPoint(x: i.maxX, y: i.minY), CGPoint(x: i.maxX, y: i.maxY), CGPoint(x: c.maxX, y: c.maxY)]
            }
        return Path { $0.addLines(points); $0.closeSubpath() }
    }

    var crownPath: Path {
        let r = crown.width * (rounded ? 0.28 : 0.2)
        return Path(roundedRect: crown, cornerRadius: r)
    }

    /// The root silhouette, two roots for molars, tapering away from the crown.
    var rootPath: Path {
        let r = root
        let base = upper ? r.maxY : r.minY
        let tip = upper ? r.minY : r.maxY
        let mid = (base + tip) / 2
        return Path { p in
            p.move(to: CGPoint(x: r.minX, y: base))
            if molar {
                p.addQuadCurve(to: CGPoint(x: r.minX + r.width * 0.22, y: tip), control: CGPoint(x: r.minX, y: tip))
                p.addQuadCurve(to: CGPoint(x: r.midX, y: mid), control: CGPoint(x: r.minX + r.width * 0.4, y: mid))
                p.addQuadCurve(to: CGPoint(x: r.maxX - r.width * 0.22, y: tip), control: CGPoint(x: r.maxX - r.width * 0.4, y: mid))
                p.addQuadCurve(to: CGPoint(x: r.maxX, y: base), control: CGPoint(x: r.maxX, y: tip))
            } else {
                p.addQuadCurve(to: CGPoint(x: r.midX, y: tip), control: CGPoint(x: r.minX + r.width * 0.1, y: tip))
                p.addQuadCurve(to: CGPoint(x: r.maxX, y: base), control: CGPoint(x: r.maxX - r.width * 0.1, y: tip))
            }
            p.closeSubpath()
        }
    }

    /// The surface under `point`, or nil outside the crown (the whole tooth).
    func surface(at point: CGPoint) -> Surface? {
        guard crown.contains(point) else { return nil }
        if inner.contains(point) { return .o }
        let distances: [(Side, CGFloat)] = [
            (.top, (point.y - crown.minY) / crown.height),
            (.bottom, (crown.maxY - point.y) / crown.height),
            (.left, (point.x - crown.minX) / crown.width),
            (.right, (crown.maxX - point.x) / crown.width),
        ]
        guard let nearest = distances.min(by: { $0.1 < $1.1 })?.0 else { return nil }
        return Surface.allCases.first { side(of: $0) == nearest }
    }

    private static let rootShare: CGFloat = 0.42
    private static let rootInset: CGFloat = 0.14
    private static let innerShare: CGFloat = 0.28
}
