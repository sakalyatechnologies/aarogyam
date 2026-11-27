import SwiftUI

/// The launch screen's ink and mark (Assets: LaunchInk, LaunchMark), drawn in so the system splash flows into the app.
/// The mark sits at the splash's size (100 pt) and centre, so the hand-off is invisible.
struct LaunchView: View {
    /// True once the app has something to show; the mark then lifts away.
    let leaving: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var aTrim: CGFloat = 0
    @State private var barTrim: CGFloat = 0
    @State private var wordShown = false
    @State private var glow = false
    @State private var dots = false

    static let ink = Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255)
    static let teal = Color(red: 94 / 255, green: 234 / 255, blue: 212 / 255)

    var body: some View {
        ZStack {
            Self.ink.ignoresSafeArea()
            ZStack {
                LaunchStroke(bar: false).trim(from: 0, to: aTrim)
                    .stroke(.white, style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
                LaunchStroke(bar: true).trim(from: 0, to: barTrim)
                    .stroke(Self.teal, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                    .shadow(color: Self.teal.opacity(glow ? 0.9 : 0.15), radius: glow ? 10 : 2)
            }
            .frame(width: 100, height: 100)
            .overlay(alignment: .top) { below.offset(y: 118) }
            .scaleEffect(leaving && !reduceMotion ? 1.08 : 1)
        }
        .opacity(leaving ? 0 : 1)
        .animation(.easeInOut(duration: reduceMotion ? 0.15 : 0.35), value: leaving)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Aarogyam")
        .task { await play() }
    }

    private var below: some View {
        VStack(spacing: 14) {
            Text("Aarogyam").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white)
                .opacity(wordShown ? 1 : 0).offset(y: wordShown || reduceMotion ? 0 : 8)
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { i in
                    Circle().fill(.white.opacity(0.7)).frame(width: 4, height: 4)
                        .opacity(dots ? 1 : 0.25)
                        .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.2), value: dots)
                }
            }
            .opacity(wordShown ? 1 : 0)
        }
        .fixedSize()
    }

    private func play() async {
        if reduceMotion {
            aTrim = 1
            barTrim = 1
            wordShown = true
            return
        }
        withAnimation(.easeOut(duration: 0.5)) { aTrim = 1 }
        try? await Task.sleep(for: .milliseconds(500))
        withAnimation(.easeOut(duration: 0.25)) { barTrim = 1 }
        try? await Task.sleep(for: .milliseconds(250))
        withAnimation(.easeOut(duration: 0.3)) { wordShown = true }
        try? await Task.sleep(for: .milliseconds(300))
        dots = true
        withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) { glow = true }
    }
}

/// The A (or its crossbar) in the mark's 100-unit grid, with no inset: the same geometry as LaunchMark.svg.
private struct LaunchStroke: Shape {
    let bar: Bool

    func path(in rect: CGRect) -> Path {
        let unit = rect.width / 100
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * unit, y: rect.minY + y * unit) }
        var path = Path()
        if bar {
            path.move(to: pt(34, 60))
            path.addLine(to: pt(66, 60))
        } else {
            path.move(to: pt(22, 82))
            path.addLine(to: pt(50, 18))
            path.addLine(to: pt(78, 82))
        }
        return path
    }
}
