import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class DeskV9Tests: XCTestCase {
    // MARK: phone field

    func testPhoneFormatsInTwoGroupsOfFive() {
        XCTAssertEqual(DeskPhone.format("9876543210"), "98765 43210")
        XCTAssertEqual(DeskPhone.format("98765"), "98765")
        XCTAssertEqual(DeskPhone.format("987654"), "98765 4")
        XCTAssertEqual(DeskPhone.format(""), "")
    }

    func testPhoneKeepsOnlyTheNationalDigits() {
        XCTAssertEqual(DeskPhone.digits("+91 98765-43210"), "9876543210")
        XCTAssertEqual(DeskPhone.digits("919876543210"), "9876543210")
        XCTAssertEqual(DeskPhone.digits("09876543210"), "9876543210")
        XCTAssertEqual(DeskPhone.digits("(98) 76a54"), "987654")
        XCTAssertEqual(DeskPhone.digits("98765432109999"), "9876543210")
        // A real number that starts with 91 is not mistaken for the country code.
        XCTAssertEqual(DeskPhone.digits("9198765432"), "9198765432")
    }

    func testPhoneIsCompleteAtTenDigits() {
        XCTAssertTrue(DeskPhone.isComplete("98765 43210"))
        XCTAssertFalse(DeskPhone.isComplete("98765 4321"))
    }

    // MARK: board grouping and Send in

    func testGroupsFollowTheBoardOrderAndKeepEmptyOnes() {
        let items: [(String, PatientState)] = [("a", .inChair), ("b", .waiting), ("c", .waiting), ("d", .called), ("e", .done)]
        let groups = DeskBoard.groups(items, state: { $0.1 })
        XCTAssertEqual(groups.map(\.state), [.waiting, .called, .inConsult, .inChair, .readyToBill])
        XCTAssertEqual(groups.map { $0.items.map(\.0) }, [["b", "c"], ["d"], [], ["a"], []])
    }

    func testSendInShowsForDoctorsOnWaitingTicketsOnly() {
        XCTAssertTrue(DeskBoard.showsSendIn(roleKey: "doctor", state: .waiting))
        XCTAssertTrue(DeskBoard.showsSendIn(roleKey: "owner", state: .waiting))
        XCTAssertFalse(DeskBoard.showsSendIn(roleKey: "front_desk", state: .waiting))
        XCTAssertFalse(DeskBoard.showsSendIn(roleKey: "assistant", state: .waiting))
        XCTAssertFalse(DeskBoard.showsSendIn(roleKey: "doctor", state: .called))
        XCTAssertFalse(DeskBoard.showsSendIn(roleKey: "doctor", state: .inChair))
    }

    func testCalledBannerIsForTheDeskWhenSomeoneIsCalled() {
        XCTAssertTrue(DeskBoard.showsCalledBanner(roleKey: "front_desk", called: 1))
        XCTAssertFalse(DeskBoard.showsCalledBanner(roleKey: "front_desk", called: 0))
        XCTAssertFalse(DeskBoard.showsCalledBanner(roleKey: "doctor", called: 2))
    }

    func testQueueAlertsHaveTitlesAndIcons() {
        for kind in ["patient_waiting", "send_in", "collect_payment"] {
            XCTAssertTrue(DeskAlert.isQueue(kind))
            XCTAssertNotNil(DeskAlert.title(kind))
            XCTAssertNotEqual(DeskAlert.icon(kind), "msg")
        }
        XCTAssertFalse(DeskAlert.isQueue("booking_requested"))
        XCTAssertNil(DeskAlert.title("booking_requested"))
    }

    func testAlertDetailShowsTheTokenAndClinicNumberNeverAName() {
        XCTAssertEqual(DeskAlert.detail(token: 7, number: "SC-1042", doctor: "Dr. Patil"), "#7 · SC-1042 · Dr. Patil")
        XCTAssertEqual(DeskAlert.detail(token: 7, number: "SC-1042", doctor: nil), "#7 · SC-1042")
        XCTAssertNil(DeskAlert.detail(token: nil, number: "SC-1042", doctor: nil))
    }

    func testRelationsMatchTheServerWords() {
        XCTAssertEqual(DeskRelation.allCases.map(\.wire), ["guardian", "child", "spouse", "parent", "sibling", "other"])
        XCTAssertEqual(DeskRelation.title(wire: "unknown"), DeskRelation.other.title)
    }

    // MARK: payment validation

    func testAmountMustBeAboveZero() {
        XCTAssertNil(DeskPay.paise(from: ""))
        XCTAssertNil(DeskPay.paise(from: "0"))
        XCTAssertNil(DeskPay.paise(from: "0.00"))
        XCTAssertNil(DeskPay.paise(from: "-5"))
        XCTAssertNil(DeskPay.paise(from: "12.345"))
        XCTAssertNil(DeskPay.paise(from: "abc"))
        XCTAssertEqual(DeskPay.paise(from: "1250"), 125_000)
        XCTAssertEqual(DeskPay.paise(from: "1,250.5"), 125_050)
        XCTAssertEqual(DeskPay.paise(from: "0.5"), 50)
    }

    func testMethodIsRequired() {
        XCTAssertEqual(DeskPay.problems(amountText: "100", method: nil), [.method])
        XCTAssertEqual(DeskPay.problems(amountText: "0", method: .upi), [.amount])
        XCTAssertEqual(DeskPay.problems(amountText: "", method: nil), [.amount, .method])
        XCTAssertEqual(DeskPay.problems(amountText: "100", method: .cash), [])
    }

    func testRupeesTextStartsTheAmountField() {
        XCTAssertEqual(DeskPay.rupeesText(paise: 125_000), "1250")
        XCTAssertEqual(DeskPay.rupeesText(paise: 125_050), "1250.5")
        XCTAssertEqual(DeskPay.rupeesText(paise: 125_005), "1250.05")
    }
}
