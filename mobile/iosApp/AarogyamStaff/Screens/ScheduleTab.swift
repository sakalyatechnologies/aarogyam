import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Schedule tab: Queue, Day and Week under a segmented control, each view's holder made the
/// first time it shows.
struct ScheduleTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    @State private var segment = 0

    var body: some View {
        ScreenHost(make: { graph.schedule(clinic: clinic, screen: $0) }, state: { $0.queue.state }) { schedule, _ in
            VStack(spacing: 0) {
                SkSegmented(
                    [String(localized: "v7.schedule.queue"), String(localized: "v7.schedule.day"), String(localized: "v7.schedule.week")],
                    selectedIndex: segment
                ) { index in
                    segment = index
                    schedule.show(segment: [ScheduleSegment.queue, .day, .week][index])
                }
                .padding(.horizontal, SkSpacing.l)
                .padding(.vertical, SkSpacing.s)
                Group {
                    switch segment {
                    case 1:
                        ScreenHost(make: { _ in schedule.day }, state: { $0.state }) { holder, state in
                            CalendarScreen(holder: holder, state: state, onOpenPatient: onOpenPatient)
                        }
                    case 2:
                        ScreenHost(make: { _ in schedule.week }, state: { $0.state }) { holder, state in
                            WeekView(holder: holder, state: state)
                        }
                    default:
                        ScreenHost(make: { _ in schedule.queue }, state: { $0.state }) { holder, state in
                            QueueScreen(holder: holder, state: state, onOpenPatient: onOpenPatient)
                        }
                    }
                }
                .transition(.opacity)
                .animation(SkMotionTokens.emphasized.animation(duration: Double(SkMotionTokens.Duration.swap) / 1000), value: segment)
            }
        }
        .navigationTitle(String(localized: "v7.tab.schedule"))
    }
}

/// The week heat map: how busy each clinic hour is, Monday to Sunday.
struct WeekView: View {
    let holder: WeekStateHolder
    let state: WeekState
    @State private var picked: (row: Int, column: Int)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(String(localized: "today.not_allowed.title"), message: String(localized: "today.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(
                        String(localized: "v7.schedule.week"), message: failed.error.message,
                        actionTitle: String(localized: "try_again"), action: holder.refresh
                    )
                case .loaded(let loaded):
                    weekHeader(loaded)
                    let grid = WeekGrid(view: loaded.view)
                    SkHeatmap(
                        rowLabels: grid.dayLabels, columnLabels: grid.hourLabels, loads: grid.loads, selected: picked,
                        onSelect: { picked = ($0, $1) },
                        describe: { grid.describe(row: $0, column: $1) }
                    )
                    SkHeatLegend(quiet: String(localized: "v7.week.quiet"), full: String(localized: "v7.week.busy"))
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { holder.refresh() }
    }

    private func weekHeader(_ loaded: WeekStateLoaded) -> some View {
        HStack {
            Button { holder.previous() } label: { V7Icon(name: "back", size: 20, label: String(localized: "v7.week.previous")) }
            Spacer()
            Text(ClinicFormat.day(iso: loaded.start.isoText)).skTextStyle(SkTypeScale.titleSmall)
            Spacer()
            Button { holder.next() } label: {
                V7Icon(name: "chev", size: 20, label: String(localized: "v7.week.next"))
            }
        }
        .buttonStyle(.skPressable)
    }
}

/// The heat map's cells and labels from a WeekView: rows are days, columns are clinic hours.
struct WeekGrid {
    let dayLabels: [String]
    let hourLabels: [String]
    let loads: [[Double]]
    private let counts: [[Int]]
    private let days: [String]
    private let hours: [Int]

    init(view: AarogyamShared.WeekView) {
        let first = Int(view.hours.first), last = Int(view.hours.last)
        let hourList = Array(first...max(first, last))
        let peak = max(Double(view.peak), 1)
        let grid: [[Int]] = view.days.map { day in
            hourList.map { hour in (day.byHour[KotlinInt(int: Int32(hour))]?.intValue) ?? 0 }
        }
        hours = hourList
        days = view.days.map { ClinicFormat.day(iso: $0.date.isoText) }
        dayLabels = view.days.map { ClinicFormat.weekdayShort(iso: $0.date.isoText) }
        hourLabels = hourList.map { WeekGrid.hourLabel($0) }
        counts = grid
        loads = grid.map { $0.map { Double($0) / peak } }
    }

    func describe(row: Int, column: Int) -> String {
        String(format: String(localized: "v7.week.cell"), days[row], WeekGrid.hourLabel(hours[column]), counts[row][column])
    }

    /// "9", "12 pm", "1": the mockup's compact hour labels.
    static func hourLabel(_ hour: Int) -> String {
        if hour == 12 { return "12 pm" }
        return String(hour > 12 ? hour - 12 : hour)
    }
}
