import AarogyamShared
import CoreGraphics
import Foundation

/// The Day view's time grid maths, kept apart from the views so it can be tested.
enum DayGrid {
    static let hourHeight: CGFloat = 48
    /// The clinic's usual day, widened when appointments fall outside it.
    static let usualHours = 9...18

    /// The hours to draw: the usual day plus any appointment outside it.
    static func hours(starts: [Int], ends: [Int]) -> ClosedRange<Int> {
        let first = min(usualHours.lowerBound, (starts.min() ?? usualHours.lowerBound * 60) / 60)
        let last = max(usualHours.upperBound, ((ends.max() ?? 0) + 59) / 60 - 1)
        return first...max(first, last)
    }

    /// Where an appointment sits in its column: its top and height, with the mock-up's 2 and 4 point insets.
    static func frame(start: Int, end: Int, firstHour: Int) -> (top: CGFloat, height: CGFloat) {
        let top = CGFloat(start - firstHour * 60) / 60 * hourHeight + 2
        let height = max(CGFloat(max(end - start, 15)) / 60 * hourHeight - 4, 24)
        return (top, height)
    }

    /// The "now" line's offset, or nil outside the drawn hours.
    static func nowOffset(minute: Int, hours: ClosedRange<Int>) -> CGFloat? {
        guard minute >= hours.lowerBound * 60, minute <= (hours.upperBound + 1) * 60 else { return nil }
        return CGFloat(minute - hours.lowerBound * 60) / 60 * hourHeight
    }

    /// The look of an appointment block: normal, waiting or in the chair (warm), finished (grey).
    enum Tone { case normal, warm, finished }

    static func tone(_ status: VisitStatus) -> Tone {
        switch status {
        case .arrived, .inChair: .warm
        case .completed, .noShow, .cancelled: .finished
        default: .normal
        }
    }

    /// Side-by-side lanes for appointments that overlap in one column: each one's lane and how many
    /// lanes its overlapping group needs. Input is in start order (the holder sorts by start).
    static func lanes(_ spans: [(start: Int, end: Int)]) -> [(lane: Int, count: Int)] {
        var result = [(lane: Int, count: Int)](repeating: (0, 1), count: spans.count)
        var group: [Int] = []
        var laneEnds: [Int] = []
        func close() {
            for index in group { result[index].count = max(laneEnds.count, 1) }
            group = []
            laneEnds = []
        }
        for (index, span) in spans.enumerated() {
            if let last = group.map({ spans[$0].end }).max(), span.start >= last { close() }
            if let free = laneEnds.firstIndex(where: { $0 <= span.start }) {
                laneEnds[free] = span.end
                result[index].lane = free
            } else {
                laneEnds.append(span.end)
                result[index].lane = laneEnds.count - 1
            }
            group.append(index)
        }
        close()
        return result
    }

    /// `12 pm`, `9`, `1`: the hour labels down the side.
    static func hourLabel(_ hour: Int) -> String { WeekGrid.hourLabel(hour) }

    /// The seven days of the Monday-to-Sunday week holding [iso], as ISO dates.
    static func week(iso: String) -> [String] {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return [] }
        let sinceMonday = (calendar.component(.weekday, from: date) + 5) % 7
        return (0..<7).compactMap { offset in
            calendar.date(byAdding: .day, value: offset - sinceMonday, to: date).map { day in
                let c = calendar.dateComponents([.year, .month, .day], from: day)
                return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
            }
        }
    }

    /// The ISO date [days] after [iso].
    static func add(days: Int, to iso: String) -> String {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        guard parts.count == 3, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              let moved = calendar.date(byAdding: .day, value: days, to: date) else { return iso }
        let c = calendar.dateComponents([.year, .month, .day], from: moved)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
