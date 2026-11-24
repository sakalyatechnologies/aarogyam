import XCTest
@testable import AarogyamStaff

final class PushV11Tests: XCTestCase {
    func testHrefRouting() {
        XCTAssertEqual(PushLogic.destination(href: "/today"), .today)
        XCTAssertEqual(PushLogic.destination(href: "/queue"), .queue)
        XCTAssertEqual(PushLogic.destination(href: "/tasks"), .tasks)
        XCTAssertEqual(PushLogic.destination(href: "/labs"), .labs)
        XCTAssertEqual(PushLogic.destination(href: "/time-off"), .timeOff)
        // A plan reply or a recall names its patient: the tap opens them.
        XCTAssertEqual(PushLogic.destination(href: "/patients/abc"), .patient("abc"))
        XCTAssertEqual(PushLogic.destination(href: nil), .today)
    }

    func testTokenIsLowercaseHex() {
        XCTAssertEqual(PushLogic.hex(Data([0x0A, 0xFF, 0x00])), "0aff00")
    }

    func testAPlanReplyOpensThePatient() {
        XCTAssertEqual(PushLogic.destination(href: "/patients/p-1"), .patient("p-1"))
        XCTAssertEqual(PushLogic.destination(href: "/patients/p-1/visits"), .today)
        XCTAssertTrue(PushLogic.kinds.contains("plan_response"))
    }

    func testEveryKindHasAPushStringInEachLanguage() {
        XCTAssertEqual(PushLogic.kinds.count, 20)
        for language in ["en"] { // English-only screens for now (founder, 23 Nov)
            guard let path = Bundle.main.path(forResource: "Localizable", ofType: "strings", inDirectory: nil, forLocalization: language),
                  let dict = NSDictionary(contentsOfFile: path) as? [String: String] else {
                XCTFail("no Localizable strings in \(language)")
                continue
            }
            for key in PushLogic.kinds.map({ "push.\($0)" }) + ["push.generic", "push.title"] {
                XCTAssertFalse((dict[key] ?? "").isEmpty, "\(key) missing in \(language)")
            }
        }
    }

    func testPrePromptCopyShipsInEachLanguage() {
        for language in ["en"] { // English-only screens for now (founder, 23 Nov)
            let path = Bundle.main.path(forResource: "PushV11", ofType: "strings", inDirectory: nil, forLocalization: language)
            let dict = path.flatMap { NSDictionary(contentsOfFile: $0) as? [String: String] } ?? [:]
            XCTAssertEqual(dict.count, 4, "PushV11 in \(language)")
        }
    }
}
