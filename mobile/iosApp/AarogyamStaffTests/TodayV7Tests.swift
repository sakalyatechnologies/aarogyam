import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class TodayV7Tests: XCTestCase {
    private let en = Locale(identifier: "en_US")

    func test_clock_is_twelve_hour_without_period() {
        XCTAssertEqual(TodayV7.clock(minuteOfDay: 0), "12:00")
        XCTAssertEqual(TodayV7.clock(minuteOfDay: 9 * 60 + 5), "9:05")
        XCTAssertEqual(TodayV7.clock(minuteOfDay: 12 * 60 + 30), "12:30")
        XCTAssertEqual(TodayV7.clock(minuteOfDay: 16 * 60 + 35), "4:35")
    }

    func test_week_strip_runs_monday_to_sunday_and_marks_today() {
        let week = TodayV7.weekStrip(iso: "2026-10-09", locale: en)
        XCTAssertEqual(week.map(\.number), [5, 6, 7, 8, 9, 10, 11])
        XCTAssertEqual(week.map(\.isToday), [false, false, false, false, true, false, false])
        XCTAssertEqual(week.map(\.letter), ["M", "T", "W", "T", "F", "S", "S"])
        // A Sunday belongs to the week that started the Monday before.
        XCTAssertEqual(TodayV7.weekStrip(iso: "2026-10-11", locale: en).first?.number, 5)
        XCTAssertEqual(TodayV7.weekStrip(iso: "2026-11-01", locale: en).map(\.number), [26, 27, 28, 29, 30, 31, 1])
        XCTAssertTrue(TodayV7.weekStrip(iso: "nope").isEmpty)
    }

    func test_dates_read_like_the_mockup() {
        XCTAssertEqual(TodayV7.monthYear(iso: "2026-10-09", locale: en), "October 2026")
        XCTAssertEqual(TodayV7.longDay(iso: "2026-10-10", locale: en), "Saturday 10 October")
    }

    func test_day_progress_clamps_and_hides_without_visits() {
        XCTAssertNil(TodayV7.dayProgress(total: 0, remaining: 0))
        let half = TodayV7.dayProgress(total: 6, remaining: 3)
        XCTAssertEqual(half?.done, 3)
        XCTAssertEqual(half?.fraction, 0.5)
        XCTAssertEqual(TodayV7.dayProgress(total: 3, remaining: 5)?.done, 0)
    }

    func test_status_pills_follow_the_mockup() {
        XCTAssertEqual(TodayV7.Pill(.completed), .done)
        XCTAssertEqual(TodayV7.Pill(.inChair), .inChair)
        XCTAssertEqual(TodayV7.Pill(.arrived), .waiting)
        XCTAssertEqual(TodayV7.Pill(.noShow), .missed)
        XCTAssertEqual(TodayV7.Pill(.cancelled), .missed)
        XCTAssertEqual(TodayV7.Pill(.booked), .booked)
        XCTAssertEqual(TodayV7.Pill(.confirmed), .booked)
        XCTAssertEqual(TodayV7.Pill.done.label, "Done")
    }

    func test_me_chips_for_a_doctor_and_for_everyone_else() {
        let doctor = TodayV7.meChips(isDoctor: true, remaining: 3, treatments: [("RCT", 2), ("Scaling", 1), ("Crown", 1)], waiting: 5, onLeave: false)
        XCTAssertEqual(doctor, ["3 patients for you", "2 RCT", "1 Scaling"])
        let one = TodayV7.meChips(isDoctor: true, remaining: 1, treatments: [], waiting: 0, onLeave: true)
        XCTAssertEqual(one, ["1 patient for you", "On leave today"])
        XCTAssertEqual(TodayV7.meChips(isDoctor: false, remaining: 0, treatments: [], waiting: 4, onLeave: false), ["4 waiting"])
    }

    func test_attention_and_notification_titles() {
        XCTAssertEqual(TodayV7.attentionTitle(kind: .lateArrival, minutes: 12), "Late by 12 min")
        XCTAssertEqual(TodayV7.attentionTitle(kind: .longWait, minutes: 30), "Waiting 30 min")
        XCTAssertEqual(TodayV7.attentionTitle(kind: .other, minutes: 0), "Needs a look")
        XCTAssertEqual(TodayV7.notificationTitle(kind: "booking_confirmed_auto"), "Booked online")
        XCTAssertEqual(TodayV7.notificationTitle(kind: "something_new"), "Notifications")
    }

    func test_booking_url_comes_from_the_clinic_origin() {
        XCTAssertEqual(TodayV7.bookingURL(origin: "https://sunrise.example.com/"), "https://sunrise.example.com/book")
        XCTAssertNil(TodayV7.bookingURL(origin: ""))
    }

    func test_qr_code_is_generated_and_initials_are_two_letters() {
        let image = QRCode.image(for: "https://sunrise.example.com/book")
        XCTAssertNotNil(image)
        XCTAssertGreaterThan(image?.size.width ?? 0, 100)
        XCTAssertEqual(Initials.of("Rahul verma"), "RV")
        XCTAssertEqual(Initials.of("Meera"), "M")
    }
}
