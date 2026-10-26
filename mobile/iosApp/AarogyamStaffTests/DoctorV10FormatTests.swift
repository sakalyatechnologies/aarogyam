import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class DoctorV10FormatTests: XCTestCase {
    func test_fee_text_is_whole_rupees_and_empty_for_none() {
        XCTAssertEqual(DoctorV10Format.feeText(paise: 150_000), "1500")
        XCTAssertEqual(DoctorV10Format.feeText(paise: nil), "")
        XCTAssertEqual(DoctorV10Format.feeText(paise: 0), "")
    }

    func test_typed_fee_goes_back_to_paise() {
        XCTAssertEqual(DoctorV10Format.feePaise(text: "₹ 1,500"), 150_000)
        XCTAssertNil(DoctorV10Format.feePaise(text: ""))
        XCTAssertNil(DoctorV10Format.feePaise(text: "0"))
    }

    func test_follow_up_chip_labels() {
        XCTAssertEqual(DoctorV10Format.followUpLabel(.oneWeek), "1 week")
        XCTAssertEqual(DoctorV10Format.followUpLabel(.twoWeeks), "2 weeks")
        XCTAssertEqual(DoctorV10Format.followUpLabel(.oneMonth), "1 month")
        XCTAssertEqual(DoctorV10Format.followUpLabel(.sixMonths), "6 months")
        XCTAssertEqual(DoctorV10Format.followUpLabel(.notNeeded), "Not needed")
    }

    func test_celebration_sent_to_desk_with_rx_and_follow_up() {
        let text = DoctorV10Format.celebration(rxIssued: true, followUpOn: "2026-11-08", collected: false, totalPaise: 150_000, locale: Locale(identifier: "en_IN"))
        XCTAssertEqual(text, "Visit closed · Rx sent · follow-up 8 Nov · desk asked for ₹1,500")
    }

    func test_celebration_without_rx_or_follow_up_or_fee() {
        let text = DoctorV10Format.celebration(rxIssued: false, followUpOn: nil, collected: false, totalPaise: nil, locale: Locale(identifier: "en_IN"))
        XCTAssertEqual(text, "Visit closed · sent to desk")
    }

    func test_celebration_collected() {
        let text = DoctorV10Format.celebration(rxIssued: false, followUpOn: nil, collected: true, totalPaise: 50_000, locale: Locale(identifier: "en_IN"))
        XCTAssertEqual(text, "Visit closed · collecting ₹500")
    }

    func test_age_and_sex_leave_out_what_is_missing() {
        XCTAssertEqual(DoctorV10Format.ageSex(age: 42, sex: "female"), "42 y · Female")
        XCTAssertEqual(DoctorV10Format.ageSex(age: nil, sex: "male"), "Male")
        XCTAssertEqual(DoctorV10Format.ageSex(age: nil, sex: ""), "")
    }
}
