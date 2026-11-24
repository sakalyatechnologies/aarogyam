import XCTest
@testable import AarogyamStaff

/// Every screen's string table ships with text in each language. A missing table doesn't fail the build:
/// the screen just shows its keys ("iv.title"), which is how the intake form's empty catalog went unnoticed.
final class StringCatalogTests: XCTestCase {
    private let tables = ["DeskV9", "DeskV10", "DoctorV10", "IntakeV10", "LiveV10", "PatientV7", "PatientV9", "TasksV10", "LabsV11", "ChatV11", "PushV11", "StoreV11", "AnalyticsV11"]

    private func keys(_ table: String, _ language: String) -> Set<String> {
        guard let path = Bundle.main.path(forResource: table, ofType: "strings", inDirectory: nil, forLocalization: language),
              let dict = NSDictionary(contentsOfFile: path) as? [String: String] else { return [] }
        return Set(dict.keys)
    }

    /// English-only screens for now (founder, 23 Nov): the hi/mr catalogs stay in git but are stripped from the app.
    func testEveryTableHasEnglishAndTheAppShipsNoHindiOrMarathi() {
        for table in tables {
            XCTAssertFalse(keys(table, "en").isEmpty, "\(table) has no English strings")
            for language in ["hi", "mr"] {
                XCTAssertTrue(keys(table, language).isEmpty, "\(table) still ships \(language)")
            }
        }
    }

    func testIntakeKeysResolveToText() {
        XCTAssertEqual(iv("iv.title"), "New patient")
        XCTAssertNotEqual(iv("iv.save"), "iv.save")
    }
}
