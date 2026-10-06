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
