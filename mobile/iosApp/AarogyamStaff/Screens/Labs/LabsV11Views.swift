import AarogyamShared
import SakalyaUI
import SwiftUI

/// The five-step tracker: done, current, to come.
struct LabTracker: View {
    let current: Int?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let steps = LabsV11.steps(current: current)
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                VStack(spacing: 5) {
                    ZStack {
                        switch step {
                        case .done:
                            Circle().fill(r.primary.color)
                            V7Icon(name: "check", size: 11, tint: r.onPrimary.color)
                        case .current:
                            Circle().fill(r.primaryContainer.color)
                            Circle().stroke(r.primary.color, lineWidth: 2)
                            Circle().fill(r.primary.color).frame(width: 8, height: 8)
                        case .todo:
                            Circle().stroke(r.outline.color, lineWidth: 1.5)
                        }
                    }
                    .frame(width: 22, height: 22)
                    Text(LabsV11.stageTitle(index)).v7Text(10.5, step == .current ? .heavy : .regular)
                        .foregroundStyle(step == .todo ? r.onSurfaceVariant.color : r.onSurface.color)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(l11f("lv.tracker.step", index + 1, LabsV11.stageTitle(index), stepWord(step)))
            }
        }
    }

    private func stepWord(_ step: LabsV11.Step) -> String {
        switch step {
        case .done: l11("lv.tracker.done")
        case .current: l11("lv.tracker.current")
        case .todo: l11("lv.tracker.todo")
        }
    }
}

/// What "Remind all" did: how many labs, who was left out, and one button per WhatsApp link.
struct LabRemindResultCard: View {
    let result: LabRemindResult
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let r = theme.roles
        V7Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(LabsV11.resultTitle(labs: result.labs.count)).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                ForEach(result.labs, id: \.vendorId) { lab in
                    if let url = LabsV11.whatsAppURL(lab.waLink) {
                        SkPillButton(l11f("lv.result.open_wa", lab.vendorName), variant: .tonal, icon: V7Icon.path("wa"), wide: true) { openURL(url) }
                    }
                }
                if !result.skipped.isEmpty {
                    V7Muted(l11f("lv.result.skipped", result.skipped.map { LabsV11.skipText($0) }.joined(separator: "; ")))
                }
                SkPillButton(l11("lv.result.done"), variant: .glass, wide: true, action: onDone)
            }
        }
    }
}
