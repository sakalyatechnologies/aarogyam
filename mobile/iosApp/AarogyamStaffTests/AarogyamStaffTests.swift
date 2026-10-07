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

final class BillingMappingTests: XCTestCase {
    func test_every_bill_status_has_copy_and_paid_is_success() {
        for status in BillStatus.allCases { XCTAssertFalse(status.label.hasPrefix("bill."), "untranslated \(status)") }
        XCTAssertEqual(BillStatus.paid.tone, .success)
        XCTAssertEqual(BillStatus.partPaid.tone, .warning)
        XCTAssertEqual(BillStatus.void.tone, .danger)
    }

    func test_every_payment_method_has_copy() {
        XCTAssertEqual(PayMethod.allCases.map(\.label), ["Cash", "UPI", "Card"])
    }

    func test_amounts_are_rupees_from_paise_with_indian_grouping() {
        XCTAssertEqual(ClinicFormat.rupees(paise: 790_000), "₹7,900")
        XCTAssertEqual(ClinicFormat.rupees(paise: 125_050), "₹1,250.50")
        XCTAssertEqual(ClinicFormat.rupees(paise: 0), "₹0")
    }

    func test_the_balance_reads_due_or_clear() {
        XCTAssertEqual(BillingView(balancePaise: 790_000, bills: []).balanceText, "₹7,900 due")
        XCTAssertEqual(BillingView(balancePaise: 0, bills: []).balanceText, "Nothing due.")
    }

    func test_the_upi_share_is_a_whole_percentage() {
        let money = MoneyView(collectedPaise: 4_820_000, paymentsToday: 9, pendingDuesPaise: 1_250_000, pendingDuesPatients: 4, upiShareBps: 6800)
        XCTAssertEqual(money.upiShareText, "68%")
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

final class PrescriptionMappingTests: XCTestCase {
    private func assertTranslated(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let looksLikeKey = text.range(of: #"^[a-z_]+(\.[a-z_]+)+$"#, options: .regularExpression) != nil
        XCTAssertFalse(text.isEmpty || looksLikeKey, "untranslated \(text)", file: file, line: line)
    }

    func test_every_status_has_copy_and_issued_is_success() {
        for status in RxStatus.allCases { assertTranslated(status.label) }
        XCTAssertEqual(RxStatus.issued.tone, .success)
        XCTAssertEqual(RxStatus.draft.tone, .warning)
        XCTAssertEqual(RxStatus.cancelled.tone, .danger)
    }

    func test_days_are_plural_aware() {
        XCTAssertEqual(RxFormat.days(1), "1 day")
        XCTAssertEqual(RxFormat.days(5), "5 days")
    }

    func test_a_medicine_line_skips_what_is_missing() {
        let full = RxMedicine(name: "AMOXICILLIN 500 mg", dose: "1 capsule", frequency: "1-0-1", durationDays: 5)
        XCTAssertEqual(full.detailText, "1 capsule · 1-0-1 · 5 days")
        let bare = RxMedicine(name: "ORS", dose: nil, frequency: "SOS", durationDays: nil)
        XCTAssertEqual(bare.detailText, "SOS")
    }

    func test_an_allergy_warning_names_the_drug_the_allergy_and_its_severity() {
        let warning = AllergyWarning(lineKey: 0, drug: "Amoxicillin", substance: "Penicillin", severity: .severe)
        XCTAssertEqual(warning.text, "Amoxicillin: recorded allergy to Penicillin (Severe)")
    }

    func test_the_share_text_names_the_clinic_and_never_the_pin() {
        let link = ShareView(url: "https://sunrise.example/shared/tok", pin: "482913", expiresAt: nil)
        let message = link.shareMessage(clinic: "Sunrise Dental")
        XCTAssertTrue(message.contains("Sunrise Dental"))
        XCTAssertFalse(message.contains("482913"))
        XCTAssertFalse(message.contains("tok"))
    }
}

final class ChartMappingTests: XCTestCase {
    private func assertTranslated(_ text: String?, file: StaticString = #filePath, line: UInt = #line) {
        let text = text ?? ""
        let looksLikeKey = text.range(of: #"^[a-z_]+(\.[a-z_]+)+$"#, options: .regularExpression) != nil
        XCTAssertFalse(text.isEmpty || looksLikeKey, "untranslated \(text)", file: file, line: line)
    }

    func test_every_chart_enum_has_copy() {
        for finding in Finding.allCases { assertTranslated(finding.label) }
        for name in SurfaceName.allCases { assertTranslated(name.label) }
        for kind in ToothKind.allCases { assertTranslated(kind.label) }
        for dentition in Dentition.allCases { assertTranslated(dentition.label) }
        assertTranslated(EntryStatus.superseded.label)
        assertTranslated(EntryStatus.enteredInError.label)
        XCTAssertNil(EntryStatus.current.label)
        XCTAssertEqual(Set(Finding.allCases.map(\.label)).count, Finding.allCases.count)
    }

    func test_the_chart_and_billing_tabs_have_copy() {
        for key in ["patient.tab.chart", "patient.tab.billing", "patient.tab.coming"] {
            assertTranslated(String(localized: String.LocalizationValue(key), table: "Chart"))
        }
    }

    func test_findings_are_drawn_apart_and_like_the_legend() {
        let p = SkPalette.tulsiLight
        XCTAssertEqual(Finding.caries.paint(p).pattern, .solid)
        XCTAssertEqual(Finding.filled.paint(p).pattern, .stripes)
        XCTAssertEqual(Finding.fractured.paint(p).pattern, .cross)
        XCTAssertEqual(Finding.sound.paint(p).fill, .clear)
        XCTAssertNotEqual(Finding.caries.paint(p), Finding.filled.paint(p))
    }

    func test_surfaces_are_named_for_the_tooth() {
        let incisor = ToothView(number: 11, whole: nil, surfaces: [:], pending: false)
        let molar = ToothView(number: 46, whole: .rootCanal, surfaces: [:], pending: false)
        XCTAssertEqual(incisor.surfaceText(.o), SurfaceName.incisal.label)
        XCTAssertEqual(incisor.surfaceText(.l), SurfaceName.palatal.label)
        XCTAssertEqual(molar.surfaceText(.o), SurfaceName.occlusal.label)
        XCTAssertEqual(molar.surfaceText(nil), String(localized: "chart.whole_tooth", table: "Chart"))
        XCTAssertEqual(molar.accessibilityText, "Tooth 46, Root canal")
    }

    func test_taps_land_on_the_surface_drawn_there() {
        let size = CGSize(width: 40, height: 60)
        // Upper right (11): root on top, so buccal is the crown's top edge and mesial faces right.
        let upperRight = ToothGeometry(upper: true, mesialFacesRight: true, kind: .incisor, size: size)
        let c = upperRight.crown
        XCTAssertEqual(upperRight.surface(at: CGPoint(x: c.midX, y: c.midY)), .o)
        XCTAssertEqual(upperRight.surface(at: CGPoint(x: c.midX, y: c.minY + 1)), .b)
        XCTAssertEqual(upperRight.surface(at: CGPoint(x: c.midX, y: c.maxY - 1)), .l)
        XCTAssertEqual(upperRight.surface(at: CGPoint(x: c.maxX - 1, y: c.midY)), .m)
        XCTAssertNil(upperRight.surface(at: CGPoint(x: c.midX, y: 2)), "the root picks the whole tooth")
        // Lower left (36): root at the bottom, mesial faces left.
        let lowerLeft = ToothGeometry(upper: false, mesialFacesRight: false, kind: .molar, size: size)
        let l = lowerLeft.crown
        XCTAssertEqual(lowerLeft.surface(at: CGPoint(x: l.midX, y: l.maxY - 1)), .b)
        XCTAssertEqual(lowerLeft.surface(at: CGPoint(x: l.minX + 1, y: l.midY)), .m)
    }

    func test_history_details_skip_what_is_missing() {
        let entry = HistoryEntryView(id: "e1", finding: .caries, surface: .o, status: .superseded, at: nil, note: nil, procedure: nil, material: nil)
        XCTAssertEqual(entry.detailText, EntryStatus.superseded.label)
        XCTAssertEqual(entry.treatmentText, "")
        let crowned = HistoryEntryView(id: "e2", finding: .crown, surface: nil, status: .current, at: nil, note: nil, procedure: "Crown", material: "Zirconia")
        XCTAssertEqual(crowned.treatmentText, "Crown · Zirconia")
    }

    func test_terms_are_matched_on_the_phone() {
        let terms = [
            TermView(id: "zirconia", kind: .material, label: "Zirconia", own: false),
            TermView(id: "cast_metal", kind: .material, label: "Metal (cast)", own: false),
            TermView(id: "pfm", kind: .material, label: "PFM (porcelain fused to metal)", own: false),
        ]
        XCTAssertEqual(ChartModelKt.matchTerms(terms: terms, kind: .material, text: "z").map(\.id), ["zirconia"])
        XCTAssertEqual(ChartModelKt.matchTerms(terms: terms, kind: .material, text: "metal").map(\.id), ["cast_metal", "pfm"])
        XCTAssertTrue(ChartModelKt.hasLabel(terms: terms, kind: .material, text: " zirconia "))
        XCTAssertEqual(Surface.o.genericLabel, "Occlusal / incisal")
    }
}

final class NotesMessagesTests: XCTestCase {
    private func assertTranslated(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertFalse(text.isEmpty, file: file, line: line)
        let looksLikeKey = text.range(of: #"^[a-z_]+(\.[a-z_]+)+$"#, options: .regularExpression) != nil
        XCTAssertFalse(looksLikeKey, "untranslated key \(text)", file: file, line: line)
    }

    func test_every_note_status_section_format_and_problem_has_copy() {
        for status in NoteStatus.allCases { assertTranslated(status.label) }
        XCTAssertEqual(NoteStatus.signed.tone, .success)
        for section in NoteSection.allCases { assertTranslated(section.label) }
        for format in Format.allCases {
            assertTranslated(format.label)
            XCTAssertFalse(format.symbol.isEmpty)
        }
        for problem in RichTextProblem.allCases { assertTranslated(problem.message) }
    }

    func test_the_shared_parser_reaches_swift_and_markup_stays_text() {
        let blocks = RichText.shared.parse(source: "## Plan\n- **RCT** on 36\n<script>alert(1)</script>")
        XCTAssertEqual(blocks.count, 3)
        guard case .paragraph(let paragraph) = onEnum(of: blocks[2]) else { return XCTFail("expected a paragraph") }
        XCTAssertEqual(String(RichTextView.attributed(paragraph.children).characters), "<script>alert(1)</script>")
        guard case .bullets(let bullets) = onEnum(of: blocks[1]) else { return XCTFail("expected bullets") }
        let item = RichTextView.attributed(bullets.items[0])
        XCTAssertEqual(String(item.characters), "RCT on 36")
        XCTAssertEqual(item.runs.first?.inlinePresentationIntent, .stronglyEmphasized)
    }

    func test_the_toolbar_formats_the_selection() {
        let bold = RichTextKt.applyFormat(value: "take rest now", start: 5, end: 9, format: .bold)
        XCTAssertEqual(bold.value, "take **rest** now")
        let list = RichTextKt.applyFormat(value: "one\ntwo", start: 0, end: 7, format: .numbers)
        XCTAssertEqual(list.value, "1. one\n2. two")
        XCTAssertEqual(RichText.shared.problem(text: "<b>x</b>"), .html)
        XCTAssertNil(RichText.shared.problem(text: "## ok\n- **fine**"))
    }

    func test_addenda_are_plural_aware() {
        XCTAssertTrue(String(localized: "notes.addenda \(1)").contains("1 addendum"))
        XCTAssertTrue(String(localized: "notes.addenda \(3)").contains("3 addenda"))
    }
}
