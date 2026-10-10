import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class ScheduleV7Tests: XCTestCase {
    func test_free_chairs_are_the_capacity_minus_the_occupied() {
        XCTAssertEqual(QueueBoard.freeChairs(chairs: 3, occupied: 1, waiting: 2), 2)
        XCTAssertEqual(QueueBoard.freeChairs(chairs: 3, occupied: 3, waiting: 2), 0)
        XCTAssertEqual(QueueBoard.freeChairs(chairs: 2, occupied: 4, waiting: 0), 0)
    }

    func test_free_chair_is_offered_when_capacity_is_unknown_and_somebody_waits() {
        XCTAssertEqual(QueueBoard.freeChairs(chairs: 0, occupied: 0, waiting: 3), 1)
        XCTAssertEqual(QueueBoard.freeChairs(chairs: 0, occupied: 0, waiting: 0), 0)
    }

    func test_wait_timers_count_on_from_the_server_reading() {
        XCTAssertEqual(QueueBoard.waitMinutes(base: 12, elapsed: 0), 12)
        XCTAssertEqual(QueueBoard.waitMinutes(base: 12, elapsed: 59), 12)
        XCTAssertEqual(QueueBoard.waitMinutes(base: 12, elapsed: 185), 15)
        XCTAssertEqual(QueueBoard.waitMinutes(base: -3, elapsed: -10), 0)
    }

    func test_day_hours_cover_the_usual_day_and_stray_appointments() {
        XCTAssertEqual(DayGrid.hours(starts: [], ends: []), 9...18)
        XCTAssertEqual(DayGrid.hours(starts: [10 * 60], ends: [11 * 60]), 9...18)
        XCTAssertEqual(DayGrid.hours(starts: [7 * 60 + 30], ends: [8 * 60]), 7...18)
        XCTAssertEqual(DayGrid.hours(starts: [17 * 60], ends: [20 * 60 + 15]), 9...20)
    }

    func test_appointment_blocks_sit_at_their_hour_with_the_mockups_insets() {
        let block = DayGrid.frame(start: 10 * 60 + 30, end: 11 * 60 + 30, firstHour: 9)
        XCTAssertEqual(block.top, 1.5 * 48 + 2)
        XCTAssertEqual(block.height, 48 - 4)
        XCTAssertEqual(DayGrid.frame(start: 540, end: 540, firstHour: 9).height, 24)
    }

    func test_now_line_is_only_inside_the_drawn_hours() {
        XCTAssertEqual(DayGrid.nowOffset(minute: 10 * 60 + 30, hours: 9...18), 1.5 * 48)
        XCTAssertNil(DayGrid.nowOffset(minute: 6 * 60, hours: 9...18))
        XCTAssertNil(DayGrid.nowOffset(minute: 22 * 60, hours: 9...18))
    }

    func test_week_and_date_arithmetic_use_iso_dates() {
        XCTAssertEqual(DayGrid.week(iso: "2026-10-09"), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"])
        XCTAssertEqual(DayGrid.add(days: 3, to: "2026-10-30"), "2026-11-02")
        XCTAssertEqual(IosDates.epochDays("1970-01-02"), 1)
        XCTAssertEqual(IosDates.epochDays("2026-10-09"), 20_735)
        XCTAssertEqual(IosDates.parse("2026-10-09").isoText, "2026-10-09")
        XCTAssertEqual(IosDates.todayISO(zone: "Asia/Kolkata", now: Date(timeIntervalSince1970: 1_791_500_000)), "2026-10-09")
    }

    func test_overlapping_appointments_share_the_column_in_lanes() {
        let lanes = DayGrid.lanes([(540, 600), (570, 630), (600, 660), (700, 730)])
        XCTAssertEqual(lanes.map(\.lane), [0, 1, 0, 0])
        XCTAssertEqual(lanes.map(\.count), [2, 2, 2, 1])
        XCTAssertTrue(DayGrid.lanes([]).isEmpty)
    }

    func test_hour_labels_match_the_week_view() {
        XCTAssertEqual(DayGrid.hourLabel(12), "12 pm")
        XCTAssertEqual(DayGrid.hourLabel(14), "2")
    }
}
