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

final class TodayV10LogicTests: XCTestCase {
    func testTasksButtonNeedsTheTasksPermission() {
        XCTAssertTrue(TodayV10Logic.showsTasks(permissions: ["tasks.use", "patients.read"]))
        XCTAssertFalse(TodayV10Logic.showsTasks(permissions: ["patients.read"]))
        XCTAssertTrue(TodayV10Logic.showsTasksOnHome(permissions: ["tasks.use", "intake.write"]))
        XCTAssertFalse(TodayV10Logic.showsTasksOnHome(permissions: ["tasks.use", "clinical.write"]), "doctors and owners don't get it by default")
    }

    func testDeskPersonGetsDeskHomeAndDoctorGetsToday() {
        XCTAssertTrue(TodayV10Logic.usesDesk(permissions: ["appointments.write", "payments.collect"]))
        XCTAssertFalse(TodayV10Logic.usesDesk(permissions: ["clinical.write", "appointments.write"]))
        XCTAssertFalse(TodayV10Logic.usesDesk(permissions: []))
    }

    func testProofLabelsAreTranslated() {
        XCTAssertEqual(TasksV10.t("tasks10.proof"), "Finish with a photo")
        XCTAssertNotEqual(TasksV10.t("tasks10.proof.library"), "tasks10.proof.library")
    }

    func testNotificationTintsFollowTheKindGroup() {
        XCTAssertEqual(TasksV10.notificationTint(kind: "patient_waiting"), .queue)
        XCTAssertEqual(TasksV10.notificationTint(kind: "collect_payment"), .money)
        XCTAssertEqual(TasksV10.notificationTint(kind: "booking_requested"), .booking)
        XCTAssertEqual(TasksV10.notificationTint(kind: "lab_overdue"), .clinical)
        XCTAssertEqual(TasksV10.notificationTint(kind: "no_such_kind"), .neutral)
    }

    func testNotificationFiltersUseKindAndReadOnly() {
        XCTAssertTrue(TasksV10.matches(.all, kind: "stock_alert", read: true))
        XCTAssertTrue(TasksV10.matches(.unread, kind: "stock_alert", read: false))
        XCTAssertFalse(TasksV10.matches(.unread, kind: "patient_waiting", read: true))
        XCTAssertTrue(TasksV10.matches(.queue, kind: "send_in", read: true))
        XCTAssertFalse(TasksV10.matches(.queue, kind: "booking_requested", read: false))
        XCTAssertTrue(TasksV10.matches(.bookings, kind: "booking_conflict", read: true))
    }

    func testTodayAndEarlierSplitOnTheCalendarDay() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = try XCTUnwrap(TimeZone(identifier: "Asia/Kolkata"))
        let now = try XCTUnwrap(TasksV10.parse("2026-11-21T06:00:00Z"))
        XCTAssertTrue(TasksV10.isToday("2026-11-20T19:00:00Z", now: now, calendar: cal))
        XCTAssertFalse(TasksV10.isToday("2026-11-20T18:00:00Z", now: now, calendar: cal))
        XCTAssertFalse(TasksV10.isToday("not a date", now: now, calendar: cal))
    }

    func testNotificationTimeIsShortAndLocalized() throws {
        let now = try XCTUnwrap(Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date()))
        let en = Locale(identifier: "en_IN")
        let iso = ISO8601DateFormatter()
        XCTAssertNil(TasksV10.notificationTime("not a date", now: now))
        let recent = try XCTUnwrap(TasksV10.notificationTime(iso.string(from: now.addingTimeInterval(-300)), now: now, locale: en))
        XCTAssertTrue(recent.contains("5"), recent)
        let old = try XCTUnwrap(TasksV10.notificationTime(iso.string(from: now.addingTimeInterval(-40 * 86_400)), now: now, locale: en))
        XCTAssertFalse(old.isEmpty)
    }
}
