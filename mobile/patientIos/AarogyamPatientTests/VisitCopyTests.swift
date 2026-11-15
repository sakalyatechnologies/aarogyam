import AarogyamPatientShared
import XCTest
@testable import AarogyamPatient

final class VisitCopyTests: XCTestCase {
    func test_tooth_and_surfaces_read_together() {
        XCTAssertEqual(VisitCopy.toothText(tooth: 16, surfaces: ["O", "D"]), "Tooth 16 · O, D")
        XCTAssertEqual(VisitCopy.toothText(tooth: 16, surfaces: []), "Tooth 16")
        XCTAssertNil(VisitCopy.toothText(tooth: nil, surfaces: []))
    }

    func test_follow_up_kinds_have_copy() {
        XCTAssertEqual(VisitCopy.kind("follow_up"), "Follow-up")
        XCTAssertEqual(VisitCopy.kind("cleaning"), "Cleaning")
        XCTAssertEqual(VisitCopy.kind("recall_xyz"), "Check-up")
    }

    func test_doctor_is_optional_in_the_row_subtitle() {
        XCTAssertEqual(VisitCopy.whoAndWhere(doctor: nil, clinic: "Sunrise Dental"), "Sunrise Dental")
        XCTAssertEqual(VisitCopy.whoAndWhere(doctor: "Dr Asha Rao", clinic: "Sunrise Dental"), "with Dr Asha Rao · Sunrise Dental")
    }

    func test_visit_dates_format_from_iso_text() {
        XCTAssertEqual(ClinicFormat.date(iso: "2026-10-12", locale: Locale(identifier: "en_GB")), "Mon, 12 Oct 2026")
    }

    func test_medicine_details_join_dose_timing_and_days() {
        let medicine = MedicineView(
            name: "Amoxicillin", strength: "500 mg", dose: "1", frequency: "1-0-1", timing: "after_food", days: 5, instructions: nil
        )
        XCTAssertEqual(medicine.detailsText, "1 · 1-0-1 · after food · for 5 days")
    }
}
