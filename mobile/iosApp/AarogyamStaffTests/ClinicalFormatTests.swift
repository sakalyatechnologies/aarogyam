import XCTest
@testable import AarogyamStaff

final class ClinicalFormatTests: XCTestCase {
    func test_timer_reads_minutes_then_hours() {
        XCTAssertEqual(ClinicalFormat.timer(seconds: 0), "0:00")
        XCTAssertEqual(ClinicalFormat.timer(seconds: 425), "7:05")
        XCTAssertEqual(ClinicalFormat.timer(seconds: 3729), "1:02:09")
        XCTAssertEqual(ClinicalFormat.timer(seconds: -5), "0:00")
    }

    func test_delta_uses_a_real_minus() {
        XCTAssertEqual(ClinicalFormat.delta(12), "+12%")
        XCTAssertEqual(ClinicalFormat.delta(-5), "\u{2212}5%")
        XCTAssertNil(ClinicalFormat.delta(nil))
    }

    func test_compact_rupees() {
        XCTAssertEqual(ClinicalFormat.compactRupees(paise: 80_000), "₹800")
        XCTAssertEqual(ClinicalFormat.compactRupees(paise: 4_500_000), "₹45k")
        XCTAssertEqual(ClinicalFormat.compactRupees(paise: 12_000_000), "₹1.2L")
        XCTAssertEqual(ClinicalFormat.compactRupees(paise: 20_000_000), "₹2L")
    }

    func test_phone_masking_and_whatsapp_digits() {
        XCTAssertEqual(ClinicalFormat.maskedPhone("9876543210"), "+91 98•••• 3210")
        XCTAssertEqual(ClinicalFormat.maskedPhone("+91 98765 43210"), "+91 98•••• 3210")
        XCTAssertNil(ClinicalFormat.maskedPhone("123"))
        XCTAssertEqual(ClinicalFormat.whatsAppDigits("09876543210"), "919876543210")
        XCTAssertNil(ClinicalFormat.whatsAppDigits(nil))
    }

    func test_delivery_urls() {
        XCTAssertEqual(ClinicalFormat.whatsAppURL(phone: "9876543210", text: "Hi & bye")?.absoluteString, "https://wa.me/919876543210?text=Hi%20%26%20bye")
        XCTAssertEqual(ClinicalFormat.whatsAppURL(phone: nil, text: "x")?.absoluteString, "https://wa.me/?text=x")
        XCTAssertEqual(ClinicalFormat.smsURL(phone: "+91 98765 43210", text: "a b")?.absoluteString, "sms:+919876543210&body=a%20b")
        XCTAssertNil(RxDeliveryChoice.print.url(phone: nil, text: "x"))
    }

    func test_heat_normalises_and_keeps_clinic_hours() {
        let heat = ClinicalFormat.heat([(1, 10, 4), (1, 10, 4), (7, 18, 2)])
        XCTAssertEqual(heat.hours.first, 9)
        XCTAssertEqual(heat.hours.last, 18)
        XCTAssertEqual(heat.loads.count, 7)
        XCTAssertEqual(heat.loads[0][1], 1)
        XCTAssertEqual(heat.loads[6][9], 0.5)
    }

    func test_radar_needs_three_kinds_and_keeps_six() {
        XCTAssertNil(ClinicalFormat.radar([("a", 3), ("b", 2)]))
        let many = (1...8).map { (key: "k\($0)", value: Int64($0)) }
        XCTAssertEqual(ClinicalFormat.radar(many)?.map(\.key), ["k8", "k7", "k6", "k5", "k4", "k3"])
    }

    func test_keys_read_as_words_and_categories_map() {
        XCTAssertEqual(ClinicalFormat.keyText("root_canal"), "Root canal")
        XCTAssertEqual(ClinicalFormat.categoryKey("SALARY"), "c.cat.salary")
        XCTAssertEqual(ClinicalFormat.categoryKey("utilities"), "c.cat.electricity")
        XCTAssertEqual(ClinicalFormat.categoryKey("equipment"), "c.cat.other")
    }

    func test_bar_labels_and_shares() {
        XCTAssertEqual(ClinicalFormat.barLabel(iso: "2026-10-05", monthly: false, narrow: false), "5")
        XCTAssertEqual(ClinicalFormat.barLabel(iso: "2026-10-01", monthly: true, narrow: false, locale: Locale(identifier: "en_IN")), "Oct")
        XCTAssertEqual(ClinicalFormat.shares([5, 10]), [0.5, 1])
        XCTAssertEqual(ClinicalFormat.weekdayRows(locale: Locale(identifier: "en_US")).first, "Mon")
    }

    func test_chat_time_today_week_and_older() {
        let zone = TimeZone(identifier: "Asia/Kolkata")!
        let locale = Locale(identifier: "en_IN")
        let now = ClinicalFormat.instant("2026-10-09T10:00:00Z")!
        XCTAssertFalse(ClinicalFormat.chatTime("2026-10-09T05:12:00Z", now: now, zone: zone, locale: locale).isEmpty)
        XCTAssertTrue(ClinicalFormat.chatTime("2026-10-06T05:12:00.250Z", now: now, zone: zone, locale: locale).hasPrefix("Tue"))
        XCTAssertTrue(ClinicalFormat.chatTime("2026-09-01T05:12:00Z", now: now, zone: zone, locale: locale).hasPrefix("1 Sep"))
        XCTAssertEqual(ClinicalFormat.chatTime("nonsense"), "")
    }
}
