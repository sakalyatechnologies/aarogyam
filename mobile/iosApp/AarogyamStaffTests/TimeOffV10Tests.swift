import XCTest
@testable import AarogyamStaff

final class TimeOffV10Tests: XCTestCase {
    private let kolkata = TimeZone(identifier: "Asia/Kolkata")!

    func testDaysRoundTripInTheClinicsZone() throws {
        let date = try XCTUnwrap(TimeOffV10.date("2026-10-12", zone: kolkata))
        XCTAssertEqual(TimeOffV10.iso(date, zone: kolkata), "2026-10-12")
        XCTAssertNil(TimeOffV10.date("not a day", zone: kolkata))
    }

    func testOneDayHasNoRange() {
        let locale = Locale(identifier: "en_US")
        let one = TimeOffV10.rangeLabel(first: "2026-10-12", last: "2026-10-12", zone: kolkata, locale: locale)
        let many = TimeOffV10.rangeLabel(first: "2026-10-12", last: "2026-10-14", zone: kolkata, locale: locale)
        XCTAssertEqual(one, TimeOffV10.dayLabel("2026-10-12", zone: kolkata, locale: locale))
        XCTAssertTrue(many.hasPrefix(one))
        XCTAssertGreaterThan(many.count, one.count)
    }
}
