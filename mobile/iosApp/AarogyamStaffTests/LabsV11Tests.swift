import XCTest
@testable import AarogyamStaff

final class LabsV11Tests: XCTestCase {
    func testStepsMarkDoneCurrentAndToCome() {
        XCTAssertEqual(LabsV11.steps(current: 2), [.done, .done, .current, .todo, .todo])
        XCTAssertEqual(LabsV11.steps(current: 4), [.done, .done, .done, .done, .current])
        XCTAssertEqual(LabsV11.steps(current: nil), Array(repeating: .todo, count: 5))
    }

    func testVendorLineSkipsMissingParts() {
        XCTAssertEqual(LabsV11.vendorLine(city: "Pune", days: 5, types: ["Crown", "Aligner"]), "Pune · ~5 days · Crown, Aligner")
        XCTAssertEqual(LabsV11.vendorLine(city: nil, days: 3, types: []), "~3 days")
        XCTAssertEqual(LabsV11.vendorLine(city: "  ", days: nil, types: ["Crown"]), "Crown")
        XCTAssertEqual(LabsV11.vendorLine(city: nil, days: nil, types: []), "")
    }

    func testOnlyWhatsAppLinksOpen() {
        XCTAssertNotNil(LabsV11.whatsAppURL("https://wa.me/919820000001?text=Hi"))
        XCTAssertNil(LabsV11.whatsAppURL("http://wa.me/1"))
        XCTAssertNil(LabsV11.whatsAppURL("https://evil.example/wa.me"))
        XCTAssertNil(LabsV11.whatsAppURL(nil))
    }

    func testResultTitleNamesTheCount() {
        XCTAssertEqual(LabsV11.resultTitle(labs: 0), "No lab was reminded")
        XCTAssertEqual(LabsV11.resultTitle(labs: 1), "Reminded 1 lab")
        XCTAssertEqual(LabsV11.resultTitle(labs: 3), "Reminded 3 labs")
    }
}
