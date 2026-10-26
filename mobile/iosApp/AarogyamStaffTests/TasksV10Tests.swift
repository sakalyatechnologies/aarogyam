import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class TasksV10Tests: XCTestCase {
    func testEverySharedIconHasASymbol() {
        let names = ["clock", "bell", "check", "alert", "calendar", "box", "msg"]
        XCTAssertEqual(names.map(TasksV10.symbol), ["clock", "bell", "checkmark.circle", "exclamationmark.triangle", "calendar", "shippingbox", "bubble.left"])
        XCTAssertEqual(TasksV10.symbol("unknown"), "bubble.left")
        XCTAssertEqual(Set(names.map(TasksV10.symbol)).count, 7)
    }

    func testUnknownKindIsGenericAndKnownKindsKeepTheirIcon() {
        XCTAssertEqual(TasksV10.notificationSymbol(kind: "no_such_kind"), "bubble.left")
        XCTAssertEqual(TasksV10.notificationSymbol(kind: "stock_alert"), "shippingbox")
        XCTAssertFalse(TasksV10.notificationTitle(kind: "").isEmpty)
        XCTAssertEqual(DeskAlert.icon("patient_waiting"), "clock")
    }

    func testDueLabelUsesTheGivenZone() throws {
        let ist = try XCTUnwrap(TimeZone(identifier: "Asia/Kolkata"))
        let now = try XCTUnwrap(TasksV10.parse("2026-10-25T06:00:00Z"))
        let label = try XCTUnwrap(TasksV10.dueLabel("2026-10-25T11:00:00Z", zone: ist, now: now, locale: Locale(identifier: "en_IN")))
        XCTAssertTrue(label.contains("4:30"), label)
        XCTAssertNil(TasksV10.dueLabel("not a date"))
    }

    func testEmptyOverdueAndOpenLabels() {
        XCTAssertFalse(TasksV10.emptyLabel().isEmpty)
        XCTAssertFalse(TasksV10.overdueLabel().isEmpty)
        XCTAssertTrue(TasksV10.openLabel(3).contains("3"))
        XCTAssertTrue(TasksV10.photosLabel(2).contains("2"))
    }

    func testQuantityNeedsAPositiveWholeNumber() {
        XCTAssertEqual(TasksV10.quantity(" 4 "), 4)
        XCTAssertNil(TasksV10.quantity("0"))
        XCTAssertNil(TasksV10.quantity("1.5"))
        XCTAssertNil(TasksV10.quantity(""))
    }
}
