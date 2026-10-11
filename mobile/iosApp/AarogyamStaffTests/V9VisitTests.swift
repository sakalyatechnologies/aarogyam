import AarogyamShared
import XCTest
@testable import AarogyamStaff

final class V9VisitTests: XCTestCase {
    // MARK: Dose cycling and the total

    func test_a_dose_cell_cycles_zero_half_one_two_and_back() {
        var frequency = "0-0-0"
        var seen: [String] = []
        for _ in 0..<5 {
            frequency = V9Dose.cycled(frequency, slot: .morning)
            seen.append(String(frequency.first!))
        }
        XCTAssertEqual(seen, ["½", "1", "2", "0", "½"])
    }

    func test_cycling_one_slot_leaves_the_others() {
        XCTAssertEqual(V9Dose.cycled("1-0-1", slot: .afternoon), "1-½-1")
        XCTAssertEqual(V9Dose.cycled("1-0-1", slot: .night), "1-0-2")
    }

    func test_an_unreadable_frequency_starts_from_nothing() {
        XCTAssertEqual(V9Dose.halves("SOS", slot: .night), 0)
        XCTAssertEqual(V9Dose.cycled("SOS", slot: .night), "0-0-½")
    }

    func test_cell_text() {
        XCTAssertEqual([0, 1, 2, 4].map { V9Dose.cell(Int32($0)) }, ["0", "½", "1", "2"])
    }

    func test_total_text_counts_tablets_rounded_up() {
        XCTAssertEqual(V9Dose.totalText(frequency: "1-0-1", days: 5, detail: "500 mg tablet"), "1-0-1 · 10 tablets")
        XCTAssertEqual(V9Dose.totalText(frequency: "½-0-0", days: 3, detail: "5 mg tablet"), "½-0-0 · 2 tablets")
        XCTAssertEqual(V9Dose.totalText(frequency: "1-0-0", days: 1, detail: "250 mg capsule"), "1-0-0 · 1 capsule")
    }

    func test_total_text_for_sos_says_up_to() {
        XCTAssertEqual(V9Dose.totalText(frequency: "1-1-1", days: 2, detail: "10 mg tablet", sos: true), "1-1-1 · up to 6 tablets")
    }

    func test_no_count_for_liquids_or_unreadable_doses() {
        XCTAssertEqual(V9Dose.totalText(frequency: "1-0-1", days: 5, detail: "0.2 % rinse"), "1-0-1")
        XCTAssertEqual(V9Dose.totalText(frequency: "SOS", days: 5, detail: "500 mg tablet"), "SOS")
    }

    func test_days_stay_between_one_and_ninety() {
        XCTAssertEqual(V9Dose.days(1, step: -1), 1)
        XCTAssertEqual(V9Dose.days(5, step: 1), 6)
        XCTAssertEqual(V9Dose.days(90, step: 1), 90)
    }

    // MARK: Close guard

    func test_close_asks_when_medicines_are_not_signed() {
        XCTAssertEqual(CloseGuard.decide(medicines: 2, signed: false), .confirmUnsigned)
    }

    func test_close_goes_ahead_when_signed_or_nothing_was_written() {
        XCTAssertEqual(CloseGuard.decide(medicines: 2, signed: true), .close)
        XCTAssertEqual(CloseGuard.decide(medicines: 0, signed: false), .close)
    }

    func test_fee_text_becomes_paise() {
        XCTAssertEqual(V9Close.paise(fromRupees: "1,500"), 150_000)
        XCTAssertEqual(V9Close.paise(fromRupees: "₹ 800"), 80_000)
        XCTAssertNil(V9Close.paise(fromRupees: ""))
        XCTAssertNil(V9Close.paise(fromRupees: "abc"))
        XCTAssertEqual(V9Close.rupees(paise: 150_000), "₹1,500")
    }

    // MARK: Tag cycle

    func test_tag_cycles_complaint_finding_advice() {
        XCTAssertEqual(NoteTag.next(.complaint), .finding)
        XCTAssertEqual(NoteTag.next(.finding), .advice)
        XCTAssertEqual(NoteTag.next(.advice), .complaint)
        XCTAssertEqual(NoteTag.next(.dictated), .finding)
    }

    func test_tag_letters_follow_the_soap_sections() {
        XCTAssertEqual([BulletKind.complaint, .dictated, .finding, .advice].map(NoteTag.letter), ["S", "S", "O", "P"])
    }

    func test_a_new_bullet_takes_the_tag_of_the_one_before() {
        XCTAssertEqual(NoteTag.kindForNew(after: []), .complaint)
        XCTAssertEqual(NoteTag.kindForNew(after: [Bullet(id: 1, kind: .finding, text: "x")]), .finding)
        XCTAssertEqual(NoteTag.kindForNew(after: [Bullet(id: 1, kind: .dictated, text: "x")]), .complaint)
    }
}
