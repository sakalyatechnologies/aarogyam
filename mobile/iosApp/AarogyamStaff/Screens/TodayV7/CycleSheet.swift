import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Log a cycle": a sterilisation cycle that ran now, with an optional note on the load, above
/// today's cycles. Needs `tasks.use`; the me card only opens it for members who have it.
struct CycleSheet: View {
    let holder: CycleLogHolder
    @State private var state = CycleLogState(cycles: [], loading: false, saving: false, error: nil)
    @State private var note = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        SkSheetScaffold(String(localized: "t7.cycle.title", table: "TodayV7")) {
            VStack(alignment: .leading, spacing: 12) {
                SkField(String(localized: "t7.cycle.note", table: "TodayV7"), text: Binding(get: { note }, set: { note = String($0.prefix(120)) }))
                if let error = state.error {
                    Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                }
                SkPillButton(String(localized: "t7.cycle.save", table: "TodayV7"), wide: true) {
                    holder.record(note: note)
                    note = ""
                }
                .disabled(state.saving)
                if state.cycles.isEmpty && !state.loading {
                    Text("t7.cycle.none", tableName: "TodayV7").font(.footnote).foregroundStyle(r.onSurfaceVariant.color)
                }
                ForEach(state.cycles, id: \.id) { cycle in
                    Text(line(cycle)).font(.body).foregroundStyle(r.onSurface.color)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .skSheet()
        .task { holder.load() }
        .task { for await next in holder.state { state = next } }
    }

    private func line(_ cycle: CycleView) -> String {
        [cycle.ranAt.map { ClinicFormat.time(minuteOfDay: $0.minuteOfDay) }, cycle.loadNote, cycle.recordedBy]
            .compactMap { $0 }.joined(separator: " · ")
    }
}
