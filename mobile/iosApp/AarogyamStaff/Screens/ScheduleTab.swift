import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Schedule tab: Queue, Day and Week under a segmented control, each view's holder made the
/// first time it shows.
struct ScheduleTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onOpenPatient: (String) -> Void
    let onWalkIn: () -> Void
    @State private var segment = ScheduleTab.firstSegment
    @State private var booking = ScheduleTab.firstBooking

    #if DEBUG && AARO_ENV_Local
    /// Screenshot runs: `SIMCTL_CHILD_AAROGYAM_DEV_SEGMENT=1` opens Day (0 Queue, 2 Week), `_SHEET=book` the booking sheet.
    private static var firstSegment: Int { Int(ProcessInfo.processInfo.environment["AAROGYAM_DEV_SEGMENT"] ?? "") ?? 0 }
    private static var firstBooking: Bool { DevLaunch.sheet == "book" }
    #else
    private static var firstSegment: Int { 0 }
    private static var firstBooking: Bool { false }
    #endif

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
                RoutesDesk.boardEntry(graph: graph, clinic: clinic, visible: segment == 0, onOpenPatient: onOpenPatient)
                Group {
                    switch segment {
                    case 1:
                        ScreenHost(make: { _ in schedule.day }, state: { $0.state }) { holder, state in
                            DayV7Screen(holder: holder, state: state, clinic: clinic, onOpenPatient: onOpenPatient)
                        }
                    case 2:
                        ScreenHost(make: { _ in schedule.week }, state: { $0.state }) { holder, state in
                            WeekV7Screen(holder: holder, state: state)
                        }
                    default:
                        ScreenHost(make: { _ in schedule.queue }, state: { $0.state }) { holder, state in
                            QueueV7Screen(holder: holder, state: state, clinic: clinic, onOpenPatient: onOpenPatient, onWalkIn: onWalkIn)
                        }
                    }
                }
                .transition(.opacity)
                .animation(SkMotionTokens.emphasized.animation(duration: Double(SkMotionTokens.Duration.swap) / 1000), value: segment)
            }
        }
        .navigationTitle(String(localized: "v7.tab.schedule"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { booking = true } label: {
                    Label { Text("t7.book.action", tableName: "TodayV7") } icon: { V7Icon.image("cal") }
                }
            }
        }
        .sheet(isPresented: $booking) {
            BookFlow(graph: graph, clinic: clinic, dateISO: IosDates.todayISO(zone: clinic.session.clinic.timezone), patientId: nil)
        }
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

    /// The cell with the most appointments (the first on a tie), or nil when the week is empty.
    func busiest() -> (row: Int, column: Int)? {
        var best: (row: Int, column: Int, count: Int)?
        for (row, line) in counts.enumerated() {
            for (column, count) in line.enumerated() where count > (best?.count ?? 0) { best = (row, column, count) }
        }
        return best.map { ($0.row, $0.column) }
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
