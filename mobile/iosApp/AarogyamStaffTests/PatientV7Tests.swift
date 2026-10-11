import AarogyamShared
import XCTest
@testable import AarogyamStaff

@MainActor
final class PatientV7Tests: XCTestCase {
    func test_tel_keeps_the_plus_and_drops_spaces() {
        XCTAssertEqual(PatientLinks.tel("+91 98765 43210")?.absoluteString, "tel:+919876543210")
        XCTAssertEqual(PatientLinks.tel("98765-43210")?.absoluteString, "tel:9876543210")
        XCTAssertNil(PatientLinks.tel(nil))
        XCTAssertNil(PatientLinks.tel("  "))
    }

    func test_whatsapp_adds_the_indian_code_to_ten_digits() {
        XCTAssertEqual(PatientLinks.whatsApp("9876543210")?.absoluteString, "https://wa.me/919876543210")
        XCTAssertEqual(PatientLinks.whatsApp("+91 98765 43210")?.absoluteString, "https://wa.me/919876543210")
        XCTAssertNil(PatientLinks.whatsApp("12345"))
    }

    func test_whatsapp_text_is_encoded_so_it_cannot_split_the_query() {
        let link = PatientLinks.whatsApp("+919876543210", message: "Case LAB-12 & more = ok")?.absoluteString
        XCTAssertEqual(link, "https://wa.me/919876543210?text=Case%20LAB-12%20%26%20more%20%3D%20ok")
    }

    func test_lab_message_names_the_case_and_never_the_patient() {
        let text = LabFormat.whatsAppText(number: "LAB-12", work: ["Crown", "Bridge"])
        XCTAssertTrue(text.contains("LAB-12"))
        XCTAssertTrue(text.contains("Crown, Bridge"))
        XCTAssertFalse(LabFormat.whatsAppText(number: "LAB-12", work: []).isEmpty)
        for patient in ["Rohan Iyer", "Rohan", "Iyer"] { XCTAssertFalse(text.contains(patient)) }
    }

    func test_overdue_compares_iso_dates_and_ignores_missing() {
        XCTAssertTrue(LabFormat.isOverdue(dueOn: "2026-10-08", today: "2026-10-09"))
        XCTAssertFalse(LabFormat.isOverdue(dueOn: "2026-10-09", today: "2026-10-09"))
        XCTAssertFalse(LabFormat.isOverdue(dueOn: nil, today: "2026-10-09"))
    }

    func test_today_uses_the_clinic_zone() {
        let late = Date(timeIntervalSince1970: 1_791_500_000) // 2026-10-08 22:13 UTC
        XCTAssertEqual(LabFormat.today(zone: "UTC", now: late), "2026-10-08")
        XCTAssertEqual(LabFormat.today(zone: "Asia/Kolkata", now: late), "2026-10-09")
    }

    func test_typed_teeth_keep_valid_fdi_numbers_once() {
        XCTAssertEqual(LabFormat.parseTeeth("46, 47 46 99 x 11"), [46, 47, 11])
        XCTAssertEqual(LabFormat.parseTeeth("55;85"), [55, 85])
        XCTAssertTrue(LabFormat.parseTeeth("").isEmpty)
    }

    func test_booking_days_roll_over_the_month() {
        XCTAssertEqual(BookingDays.next(3, from: "2026-10-30"), ["2026-10-30", "2026-10-31", "2026-11-01"])
        XCTAssertTrue(BookingDays.next(3, from: "bad").isEmpty)
    }

    func test_expiry_formats_in_the_clinic_zone() {
        XCTAssertEqual(ClinicFormat.dateTime(iso8601: "2026-10-16T20:00:00Z", zone: "Asia/Kolkata", locale: Locale(identifier: "en_IN")), "17 Oct 2026")
        XCTAssertNil(ClinicFormat.dateTime(iso8601: "soon", zone: "UTC"))
    }

    func test_only_recalls_can_be_filtered_today() {
        XCTAssertTrue(PatientFilter.dues.needsServer)
        XCTAssertTrue(PatientFilter.fresh.needsServer)
        XCTAssertFalse(PatientFilter.recalls.needsServer)
        XCTAssertFalse(PatientFilter.all.needsServer)
    }

    func test_findings_map_to_the_jaw_colours() {
        XCTAssertEqual(JawTone.of(.sound), .plain)
        XCTAssertEqual(JawTone.of(.filled), .treated)
        XCTAssertEqual(JawTone.of(.crown), .treated)
        XCTAssertEqual(JawTone.of(.rootCanal), .progress)
        XCTAssertEqual(JawTone.of(.watch), .watch)
        XCTAssertEqual(JawTone.of(.caries), .care)
        XCTAssertEqual(JawTone.of(.missing), .missing)
    }

    func test_the_jaw_places_every_tooth_of_both_dentitions() {
        XCTAssertEqual(JawGeometry.shared.spots(dentition: .adult).count, 32)
        XCTAssertEqual(JawGeometry.shared.spots(dentition: .child).count, 20)
        let spots = JawGeometry.shared.spots(dentition: .adult)
        XCTAssertTrue(spots.allSatisfy { (0...1).contains($0.x) && (0...1).contains($0.y) })
        XCTAssertTrue(spots.filter(\.upper).allSatisfy { $0.y < 0.5 })
    }

    func test_teeth_are_named_by_quadrant() {
        XCTAssertEqual(ToothName.quadrant(46), pv("pv.tooth.lower_right"))
        XCTAssertEqual(ToothName.quadrant(21), pv("pv.tooth.upper_left"))
        XCTAssertEqual(ToothName.quadrant(55), pv("pv.tooth.upper_right"))
        XCTAssertEqual(ToothName.quadrant(74), pv("pv.tooth.lower_left"))
    }

    func test_lab_pills() {
        XCTAssertEqual(LabStatus.sent.pill(overdue: true).kind, .error)
        XCTAssertEqual(LabStatus.sent.pill(overdue: false).kind, .neutral)
        XCTAssertEqual(LabStatus.received.pill(overdue: true).kind, .done)
        XCTAssertEqual(LabStatus.rework.pill(overdue: false).kind, .error)
    }

    func test_every_block_reason_has_copy() {
        for reason in [TreatmentBlock.noTreatment, .needsVisit, .noChartMark, .surfaceChangePreview] {
            XCTAssertFalse(reason.message.isEmpty)
            XCTAssertNotEqual(reason.message, "pv.block.no_treatment")
        }
    }

    func test_the_string_table_has_hindi_and_marathi_for_a_sample() {
        for lang in ["hi", "mr"] {
            let bundle = Bundle.main.path(forResource: lang, ofType: "lproj").flatMap(Bundle.init(path:))
            XCTAssertNotNil(bundle, lang)
            XCTAssertNotEqual(bundle?.localizedString(forKey: "pv.tab.bills", value: nil, table: "PatientV7"), "pv.tab.bills")
        }
    }
}
