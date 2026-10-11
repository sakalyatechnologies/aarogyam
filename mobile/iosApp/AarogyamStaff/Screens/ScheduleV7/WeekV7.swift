import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Week view of the v7 Schedule: the heat map in a card, the busiest hour from the real
/// counts, and the "open slots worth filling" list as a preview (the server has no free-slot summary).
struct WeekV7Screen: View {
    let holder: WeekStateHolder
    let state: WeekState
    @State private var picked: (row: Int, column: Int)?
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(String(localized: "today.not_allowed.title"), message: String(localized: "today.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(String(localized: "v7.schedule.week"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    content(loaded)
                }
            }
            .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { holder.refresh() }
    }

    @ViewBuilder private func content(_ loaded: WeekStateLoaded) -> some View {
        let r = theme.roles
        let grid = WeekGrid(view: loaded.view)
        HStack {
            Button { holder.previous() } label: { V7Icon(name: "back", size: 20, label: String(localized: "v7.week.previous")).frame(width: 44, height: 44) }
            Spacer()
            Text(ClinicFormat.day(iso: loaded.start.isoText)).skTextStyle(SkTypeScale.titleSmall).foregroundStyle(r.onSurface.color)
            Spacer()
            Button { holder.next() } label: { V7Icon(name: "chev", size: 20, label: String(localized: "v7.week.next")).frame(width: 44, height: 44) }
        }
        .buttonStyle(.skPressable)
        SkCard {
            VStack(alignment: .leading, spacing: 10) {
                SkHeatmap(
                    rowLabels: grid.dayLabels, columnLabels: grid.hourLabels, loads: grid.loads, selected: picked,
                    onSelect: { picked = ($0, $1) }, describe: { grid.describe(row: $0, column: $1) }
                )
                SkHeatLegend(quiet: String(localized: "v7.week.quiet"), full: String(localized: "v7.week.busy"))
            }
        }
        if let busiest = grid.busiest() {
            TodaySectionHeader(title: String(format: String(localized: "t7.week.busiest", table: "TodayV7"), grid.describe(row: busiest.row, column: busiest.column)))
        }
        Text("t7.week.open_slots", tableName: "TodayV7").skTextStyle(SkTypeScale.footnote).foregroundStyle(r.onSurfaceVariant.color).padding(.horizontal, 2)
        PreviewNotice()
    }
}
