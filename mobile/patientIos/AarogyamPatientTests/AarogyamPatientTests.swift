import AarogyamPatientShared
import SakalyaUI
import XCTest
@testable import AarogyamPatient

final class MessagesTests: XCTestCase {
    /// A key missing from the String Catalog comes back as the key itself.
    private func assertTranslated(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(text.isEmpty, file: file, line: line)
        let looksLikeKey = text.range(of: #"^[a-z_]+(\.[a-z_]+)+$"#, options: .regularExpression) != nil
        XCTAssertFalse(looksLikeKey, "untranslated key \(text)", file: file, line: line)
    }

    func test_every_screen_error_has_copy() {
        for error in ScreenError.allCases { assertTranslated(error.message) }
    }

    func test_every_sign_in_and_link_error_has_copy() {
        for error in SignInError.allCases { assertTranslated(error.message) }
        for error in LinkError.allCases { assertTranslated(error.message) }
        for error in BookingError.allCases { assertTranslated(error.message) }
    }

    func test_every_visit_status_has_a_label_and_tone() {
        for status in VisitStatus.allCases { assertTranslated(status.label) }
        XCTAssertEqual(VisitStatus.requested.tone, .warning)
        XCTAssertEqual(VisitStatus.confirmed.tone, .success)
    }

    func test_medicine_timings_read_as_words() {
        XCTAssertEqual(Timing.text("after_food"), "after food")
        XCTAssertEqual(Timing.text("something new"), "as directed")
    }
}

final class MappingTests: XCTestCase {
    func test_clinic_times_are_wall_clock_values_from_the_api() {
        guard let at = ClinicTime.companion.parse(text: "2026-10-12T17:30:00+05:30") else {
            return XCTFail("the API's time did not parse")
        }
        XCTAssertEqual(at.date.isoText, "2026-10-12")
        XCTAssertEqual(ClinicFormat.time(minuteOfDay: at.time.minuteOfDay, locale: Locale(identifier: "en_US")), "5:30\u{202F}PM")
        XCTAssertEqual(ClinicFormat.date(iso: "2026-10-12", locale: Locale(identifier: "en_GB")), "Mon, 12 Oct 2026")
        XCTAssertNil(ClinicTime.companion.parse(text: "soon"))
    }

    func test_rupees_use_indian_grouping() {
        XCTAssertEqual(ClinicFormat.rupees(paise: 12_500_000), "₹1,25,000")
        XCTAssertEqual(ClinicFormat.rupees(paise: 12_550), "₹125.50")
    }

    func test_appointment_copy_names_the_doctor_and_clinic() {
        let visit = AppointmentView(
            id: "a1", clinicId: "c1", clinicName: "Sunrise Dental", doctorName: "Dr Asha Rao", specialty: nil,
            at: nil, status: .confirmed, canCancel: true
        )
        XCTAssertEqual(visit.whoAndWhere, "with Dr Asha Rao · Sunrise Dental")
    }

    func test_build_settings_pick_the_environment() {
        let config = BuildSettings.config(info: ["AarogyamEnvironment": "Local"], secrets: ["SupabaseURL": "https://x.supabase.co"], debug: true)
        XCTAssertEqual(config.environment, .local)
        XCTAssertEqual(BuildSettings.config(info: [:], secrets: [:], debug: false).environment, .prod)
    }
}
