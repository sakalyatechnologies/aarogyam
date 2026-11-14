import XCTest
@testable import AarogyamStaff

final class LiveV10Tests: XCTestCase {
    func test_each_banner_kind_names_the_token() {
        XCTAssertEqual(LiveV10Logic.text(kind: "patient_waiting", token: 12), "Token 12 is waiting for you")
        XCTAssertEqual(LiveV10Logic.text(kind: "send_in", token: 12), "Token 12: the doctor is ready for them")
        XCTAssertEqual(LiveV10Logic.text(kind: "collect_payment", token: 12), "Token 12 is ready to pay")
    }

    func test_a_missing_token_still_gives_a_line_without_a_number() {
        let line = LiveV10Logic.text(kind: "send_in", token: nil)
        XCTAssertNotNil(line)
        XCTAssertFalse(line?.contains("%") ?? true)
    }

    func test_an_unknown_kind_has_no_banner() {
        XCTAssertNil(LiveV10Logic.text(kind: "task_assigned", token: 3))
        XCTAssertNil(LiveV10Logic.text(kind: "", token: nil))
    }
}
