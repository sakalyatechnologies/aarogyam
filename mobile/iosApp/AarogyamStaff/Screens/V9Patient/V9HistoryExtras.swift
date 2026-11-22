import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the `/history` cards add over the old list: per-tooth work, the note's first line,
/// the medicines and the plans.
enum HistoryWork {
    /// The most advanced work on a tooth in the visit: done beats in progress beats planned.
    static func of(_ row: VisitRow, tooth: Int) -> ToothWork? {
        row.work.filter { Int($0.tooth) == tooth }.max { rank($0.kind) < rank($1.kind) }
    }

    private static func rank(_ kind: ToothWorkKind) -> Int {
        switch kind {
        case .done, .elsewhere: 4
        case .inProgress: 3
        case .planned: 2
        case .found: 1
        }
    }

    static func text(_ work: ToothWork) -> String {
        let kind = switch work.kind {
        case .done: p9("p9.work.done")
        case .planned: p9("p9.work.planned")
        case .inProgress: p9("p9.work.in_progress")
        case .elsewhere: p9("p9.work.elsewhere")
        case .found: p9("p9.work.found")
        }
        return [work.label, kind].compactMap { $0 }.joined(separator: ", ")
    }

    /// Done reads calm (primary), planned or in progress warm (tertiary), the rest neutral.
    static func colors(_ work: ToothWork, _ r: SkRoles) -> (Color, Color) {
        switch work.kind {
        case .done: (r.primaryContainer.color, r.onPrimaryContainer.color)
        case .planned, .inProgress: (r.tertiaryContainer.color, r.onTertiaryContainer.color)
        case .elsewhere, .found: (r.surface2.color, r.onSurfaceVariant.color)
        }
    }

    /// The note's first line, the medicines and the plans, one line each.
    static func lines(_ row: VisitRow) -> [String] {
        var out: [String] = []
        if let note = row.noteLine { out.append(note) }
        if !row.medicines.isEmpty { out.append(p9f("p9.history.rx_line", row.medicines.joined(separator: ", "))) }
        if !row.plans.isEmpty { out.append(p9f("p9.history.plan_line", row.plans.map(\.title).joined(separator: ", "))) }
        return out
    }
}

/// The detail lines under a History card's chips.
struct HistoryDetails: View {
    let row: VisitRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let lines = HistoryWork.lines(row)
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
                    let isNote = i == 0 && row.noteLine != nil
                    Text(line).v7Text(12, isNote ? .medium : .regular)
                        .foregroundStyle(theme.roles.onSurfaceVariant.color)
                        .lineLimit(isNote ? 2 : 1)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(.top, 4)
        }
    }
}

/// "Show older visits": the next page of the History tab.
struct OlderVisitsButton: View {
    let loading: Bool
    let action: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        Button(action: action) {
            Group {
                if loading { ProgressView() } else { Text(p9("p9.history.more")).v7Text(14, .bold) }
            }
            .foregroundStyle(theme.roles.primary.color)
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(loading)
    }
}
