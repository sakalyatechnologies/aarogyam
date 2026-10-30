import XCTest
@testable import AarogyamStaff

/// Every screen's string table ships with text in each language. A missing table doesn't fail the build:
/// the screen just shows its keys ("iv.title"), which is how the intake form's empty catalog went unnoticed.
final class StringCatalogTests: XCTestCase {
    private let tables = ["DeskV9", "DeskV10", "DoctorV10", "IntakeV10", "PatientV7", "PatientV9", "TasksV10"]

    private func keys(_ table: String, _ language: String) -> Set<String> {
        guard let path = Bundle.main.path(forResource: table, ofType: "strings", inDirectory: nil, forLocalization: language),
              let dict = NSDictionary(contentsOfFile: path) as? [String: String] else { return [] }
        return Set(dict.keys)
    }

    func testEveryTableHasTextInEnglishHindiAndMarathi() {
        for table in tables {
            let en = keys(table, "en")
            XCTAssertFalse(en.isEmpty, "\(table) has no English strings")
            for language in ["hi", "mr"] {
                XCTAssertEqual(keys(table, language), en, "\(table) differs in \(language)")
            }
        }
    }

    func testIntakeKeysResolveToText() {
        XCTAssertEqual(iv("iv.title"), "New patient")
        XCTAssertNotEqual(iv("iv.save"), "iv.save")
    }
}
