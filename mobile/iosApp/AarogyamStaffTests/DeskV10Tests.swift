import XCTest
@testable import AarogyamStaff

final class DeskV10Tests: XCTestCase {
    // MARK: wait timer

    func testClockFormat() {
        XCTAssertEqual(DeskV10Wait.clock(seconds: 0), "0:00")
        XCTAssertEqual(DeskV10Wait.clock(seconds: 42), "0:42")
        XCTAssertEqual(DeskV10Wait.clock(seconds: 60), "1:00")
        XCTAssertEqual(DeskV10Wait.clock(seconds: 4503), "75:03")
        XCTAssertEqual(DeskV10Wait.clock(seconds: -5), "0:00")
    }

    func testAmberStartsAtSixtySeconds() {
        XCTAssertFalse(DeskV10Wait.isNoReply(seconds: 59))
        XCTAssertTrue(DeskV10Wait.isNoReply(seconds: 60))
        XCTAssertTrue(DeskV10Wait.isNoReply(seconds: 600))
    }

    func testElapsedUsesTheClockGivenAndNeverGoesNegative() {
        let issued = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(DeskV10Wait.elapsed(since: issued, now: Date(timeIntervalSince1970: 1_042)), 42)
        XCTAssertEqual(DeskV10Wait.elapsed(since: issued, now: Date(timeIntervalSince1970: 900)), 0)
    }

    func testWaitingAndCheckLines() {
        XCTAssertEqual(DeskV10Wait.waitingLine(doctor: "Patil", seconds: 42), "Waiting for Dr Patil · 0:42")
        XCTAssertEqual(DeskV10Wait.waitingLine(doctor: "Dr. Patil", seconds: 61), "Waiting for Dr. Patil · 1:01")
        XCTAssertEqual(DeskV10Wait.waitingLine(doctor: nil, seconds: 5), "Waiting · 0:05")
        XCTAssertEqual(DeskV10Wait.checkLine(doctor: "Dr. Patil"), "Check with Dr. Patil")
        XCTAssertEqual(DeskV10Wait.checkLine(doctor: nil), "Check with the doctor")
    }

    // MARK: doctor chips

    private let free = DeskV10Doctor(id: "a", name: "Rao", free: true)
    private let busy = DeskV10Doctor(id: "b", name: "Dr. Patil", free: false)

    func testChipText() {
        XCTAssertEqual(DeskV10Doctors.checkInTitle(free), "Check in · Dr Rao")
        XCTAssertEqual(DeskV10Doctors.checkInTitle(busy), "Check in · Dr. Patil")
        XCTAssertEqual(DeskV10Doctors.checkInTitle(nil), "Check in")
    }

    func testPickPrefersChosenThenFreeLastThenAnyFreeThenLast() {
        let all = [free, busy]
        XCTAssertEqual(DeskV10Doctors.pick(doctors: all, lastDoctorId: "a", chosenId: "b"), busy)
        XCTAssertEqual(DeskV10Doctors.pick(doctors: all, lastDoctorId: "a", chosenId: nil), free)
        XCTAssertEqual(DeskV10Doctors.pick(doctors: all, lastDoctorId: "b", chosenId: nil), free)
        XCTAssertEqual(DeskV10Doctors.pick(doctors: [busy], lastDoctorId: "b", chosenId: nil), busy)
        XCTAssertNil(DeskV10Doctors.pick(doctors: [busy], lastDoctorId: nil, chosenId: nil))
        XCTAssertNil(DeskV10Doctors.pick(doctors: [], lastDoctorId: "a", chosenId: "a"))
    }

    // MARK: banner, collect, strip

    func testCalledBannerUsesTokenNumbersOnly() {
        XCTAssertEqual(DeskV10Banner.calledText(tokens: [12]), "Token 12 is called")
        XCTAssertEqual(DeskV10Banner.calledText(tokens: [14, 12]), "Tokens 12, 14 are called")
    }

    func testDoctorMayBeCollectingForTwoMinutes() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertTrue(DeskV10Collect.mayBeCollecting(status: "ready_to_bill", endedAt: now.addingTimeInterval(-119), now: now))
        XCTAssertFalse(DeskV10Collect.mayBeCollecting(status: "ready_to_bill", endedAt: now.addingTimeInterval(-120), now: now))
        XCTAssertFalse(DeskV10Collect.mayBeCollecting(status: "waiting", endedAt: now, now: now))
        XCTAssertFalse(DeskV10Collect.mayBeCollecting(status: "ready_to_bill", endedAt: nil, now: now))
    }

    func testStripChipsKeepZerosAndSkipEmptyGroups() {
        let chips = DeskV10Strip.chips(doctorsFree: 1, withPatient: 0, away: 2, hasDoctors: true, chairsFree: 3, chairsBusy: 1, hasChairs: true)
        XCTAssertEqual(chips.map(\.text), ["Doctors free 1", "With a patient 0", "Away 2", "Chairs free 3", "Chairs busy 1"])
        let none = DeskV10Strip.chips(doctorsFree: 0, withPatient: 0, away: 0, hasDoctors: false, chairsFree: 0, chairsBusy: 0, hasChairs: false)
        XCTAssertTrue(none.isEmpty)
    }

    // MARK: flags

    func testControlsHideWhenFlagsAreOff() {
        let off = DeskV10Caps()
        XCTAssertFalse(off.showsFamily)
        XCTAssertFalse(off.showsProof)
        XCTAssertFalse(off.showsRemind)
        let on = DeskV10Caps(family: true, paymentProof: true, queueRemind: true)
        XCTAssertTrue(on.showsFamily && on.showsProof && on.showsRemind)
    }

    func testRemindShowsOnNoReplyForDeskRolesAndHidesForAMinute() {
        let caps = DeskV10Caps(queueRemind: true)
        let desk: Set<String> = ["appointments.write"]
        let now = Date()
        XCTAssertFalse(DeskV10Wait.showsRemind(caps: caps, permissions: desk, seconds: 59, remindedAt: nil, now: now))
        XCTAssertTrue(DeskV10Wait.showsRemind(caps: caps, permissions: desk, seconds: 60, remindedAt: nil, now: now))
        XCTAssertFalse(DeskV10Wait.showsRemind(caps: caps, permissions: ["appointments.read"], seconds: 90, remindedAt: nil, now: now))
        XCTAssertFalse(DeskV10Wait.showsRemind(caps: DeskV10Caps(), permissions: desk, seconds: 90, remindedAt: nil, now: now))
        XCTAssertFalse(DeskV10Wait.showsRemind(caps: caps, permissions: desk, seconds: 90, remindedAt: now.addingTimeInterval(-59), now: now))
        XCTAssertTrue(DeskV10Wait.showsRemind(caps: caps, permissions: ["clinical.write"], seconds: 90, remindedAt: now.addingTimeInterval(-60), now: now))
    }

    func testCollectNeedsPaymentsCollectOrBothBillKeys() {
        XCTAssertTrue(DeskV10Collect.canCollect(["payments.collect"]))
        XCTAssertTrue(DeskV10Collect.canCollect(["billing.read", "billing.write"]))
        XCTAssertFalse(DeskV10Collect.canCollect(["billing.write"]))
    }

    func testRfc3339MinuteOfDayIsClinicLocal() {
        XCTAssertEqual(DeskV10Feed.minuteOfDay(rfc3339: "2026-10-12T04:30:00Z", zoneId: "Asia/Kolkata"), 10 * 60)
        XCTAssertEqual(DeskV10Feed.minuteOfDay(rfc3339: "2026-10-12T09:15:30.250+05:30", zoneId: "Asia/Kolkata"), 9 * 60 + 15)
        XCTAssertEqual(DeskV10Feed.minuteOfDay(rfc3339: "nonsense", zoneId: "Asia/Kolkata"), 0)
    }
}
