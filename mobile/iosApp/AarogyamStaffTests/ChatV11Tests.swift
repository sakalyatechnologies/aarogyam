import XCTest
@testable import AarogyamStaff

final class ChatV11Tests: XCTestCase {
    func testOnlyWebLinksWithAHostAreOpened() {
        XCTAssertNotNil(ChatFile.openable("https://clinic.example/files/f1?t=abc"))
        XCTAssertNotNil(ChatFile.openable("http://localhost:8080/x"))
        XCTAssertNil(ChatFile.openable("javascript:alert(1)"))
        XCTAssertNil(ChatFile.openable("file:///etc/passwd"))
        XCTAssertNil(ChatFile.openable("/files/f1"))
        XCTAssertNil(ChatFile.openable("https://"))
    }

    func testSizeLabelIsHumanReadable() {
        XCTAssertTrue(ChatFile.sizeLabel(340_000).contains("KB"))
        XCTAssertTrue(ChatFile.sizeLabel(1_200_000).contains("MB"))
    }

    func testChatStringsResolve() {
        XCTAssertEqual(c11("c11.notice.toggle"), "Post as notice")
        XCTAssertNotEqual(c11("c11.attach"), "c11.attach")
    }
}
