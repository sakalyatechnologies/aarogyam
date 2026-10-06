import AarogyamShared
import SakalyaUI
import XCTest
@testable import AarogyamStaff

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

    func test_every_sign_in_error_has_copy() {
        for error in SignInError.allCases { assertTranslated(error.message) }
    }

    func test_every_visit_status_has_a_label() {
        for status in VisitStatus.allCases { assertTranslated(status.label) }
        XCTAssertEqual(VisitStatus.completed.tone, .success)
        XCTAssertEqual(VisitStatus.arrived.tone, .warning)
    }

    func test_clinic_times_are_wall_clock_values() {
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(ClinicFormat.time(minuteOfDay: 9 * 60 + 5, locale: locale), "9:05\u{202F}AM")
        XCTAssertEqual(ClinicFormat.time(minuteOfDay: 17 * 60 + 30, locale: locale), "5:30\u{202F}PM")
    }

    func test_clinic_dates_read_like_the_mock_up() {
        XCTAssertEqual(ClinicFormat.day(iso: "2026-10-03", locale: Locale(identifier: "en_GB")), "Sat 3 Oct")
        XCTAssertEqual(ClinicFormat.day(iso: "not a date"), "not a date")
    }
}

final class PatientMappingTests: XCTestCase {
    private func assertTranslated(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let looksLikeKey = text.range(of: #"^[a-z_]+(\.[a-z_]+)+$"#, options: .regularExpression) != nil
        XCTAssertFalse(text.isEmpty || looksLikeKey, "untranslated \(text)", file: file, line: line)
    }

    func test_every_severity_has_copy_and_severe_is_danger() {
        for severity in Severity.allCases { assertTranslated(severity.label) }
        XCTAssertEqual(Severity.severe.tone, .danger)
        XCTAssertEqual(Severity.moderate.tone, .warning)
    }

    func test_known_sexes_have_copy_and_unknown_is_left_out() {
        for sex in [Sex.female, .male, .other] { assertTranslated(sex.label ?? "") }
        XCTAssertNil(Sex.unknown.label)
    }

    func test_the_patient_line_skips_what_is_missing() {
        XCTAssertEqual(patientLine(number: "SD-1042", ageYears: 34, sex: .female), "SD-1042 · Age 34 · Female")
        XCTAssertEqual(patientLine(number: "SD-1042", ageYears: nil, sex: .unknown), "SD-1042")
    }

    func test_money_uses_indian_grouping() {
        XCTAssertEqual(ClinicFormat.rupees(paise: 125_000), "₹1,250")
        XCTAssertEqual(ClinicFormat.rupees(paise: 12_345_600), "₹1,23,456")
    }

    func test_dates_read_as_clinic_wall_clock_days() {
        XCTAssertEqual(ClinicFormat.date(iso: "2026-10-05", locale: Locale(identifier: "en_GB")), "5 Oct 2026")
        XCTAssertEqual(ClinicFormat.date(iso: "bad"), "bad")
    }
}

final class ThemeTests: XCTestCase {
    func test_the_default_brand_draws_the_tulsi_palette() {
        let light = ClinicBranding.companion.Default.skTheme(systemDark: false)
        XCTAssertEqual(light.palette, .tulsiLight)
        XCTAssertFalse(light.isDark)
        let dark = ClinicBranding.companion.Default.skTheme(systemDark: true)
        XCTAssertEqual(dark.palette, .tulsiDark)
        XCTAssertTrue(dark.isDark)
    }
}

final class BuildSettingsTests: XCTestCase {
    func test_reads_the_environment_and_supabase_settings() {
        let config = BuildSettings.config(
            info: ["AarogyamEnvironment": "Demo", "CFBundleShortVersionString": "0.1.0"],
            secrets: ["SupabaseURL": "https://example.supabase.co", "SupabaseKey": "publishable"],
            debug: true
        )
        XCTAssertEqual(config.environment, .demo)
        XCTAssertEqual(config.version, "0.1.0")
        XCTAssertEqual(config.supabaseUrl, "https://example.supabase.co")
        XCTAssertEqual(config.prodAppHost, "")
    }

    func test_an_unknown_environment_is_prod() {
        XCTAssertEqual(BuildSettings.config(info: [:], secrets: [:], debug: false).environment, .prod)
    }
}
