import AarogyamShared
import XCTest
@testable import AarogyamStaff

@MainActor
final class PatientV9Tests: XCTestCase {
    private let doctor: Set<String> = ["patients.read", "clinical.read", "clinical.write", "billing.read"]
    private let assistant: Set<String> = ["patients.read", "clinical.read", "clinical.write"]
    private let frontDesk: Set<String> = ["patients.read", "billing.read"]

    func test_every_clinical_role_sees_the_three_tabs_in_order() {
        XCTAssertEqual(PatientPageTab.visible(permissions: doctor), [.overview, .history, .consent])
        XCTAssertEqual(PatientPageTab.visible(permissions: assistant), [.overview, .history, .consent])
    }

    func test_a_role_without_clinical_read_has_no_overview() {
        XCTAssertEqual(PatientPageTab.visible(permissions: frontDesk), [.history, .consent])
        XCTAssertTrue(PatientPageTab.visible(permissions: ["billing.read"]).isEmpty)
    }

    func test_history_title_carries_the_count_once_known() {
        XCTAssertEqual(PatientPageTab.history.title(historyCount: 4), "History · 4")
        XCTAssertEqual(PatientPageTab.history.title(historyCount: nil), "History")
    }

    func test_money_is_hidden_by_default() {
        let money = MoneySummary(visits: 3, paidPaise: 120_000, remainingPaise: 30_000)
        XCTAssertEqual(MoneyStripModel.make(money: money, shown: false), .closed)
    }

    func test_money_opens_to_three_cells() {
        let money = MoneySummary(visits: 3, paidPaise: 120_000, remainingPaise: 30_000)
        XCTAssertEqual(MoneyStripModel.make(money: money, shown: true), .open(visits: "3", paid: "₹1,200", due: "₹300", hasDue: true))
        let clear = MoneySummary(visits: 1, paidPaise: 50_000, remainingPaise: 0)
        guard case .open(_, _, _, let hasDue) = MoneyStripModel.make(money: clear, shown: true) else { return XCTFail("open") }
        XCTAssertFalse(hasDue)
    }

    func test_the_assistant_gets_no_money_strip_whether_or_not_it_is_toggled() {
        // The holder sends no summary without billing.read, so there is nothing to draw.
        XCTAssertFalse(assistant.contains("billing.read"))
        XCTAssertEqual(MoneyStripModel.make(money: nil, shown: false), .none)
        XCTAssertEqual(MoneyStripModel.make(money: nil, shown: true), .none)
    }

    func test_date_badge_shows_today_and_day_with_month() {
        let en = Locale(identifier: "en_IN")
        XCTAssertEqual(HistoryRowFormat.badge(dateISO: "2026-10-11", todayISO: "2026-10-11", locale: en), .init(top: "Today", bottom: nil))
        XCTAssertTrue(HistoryRowFormat.badge(dateISO: "2026-10-11", todayISO: "2026-10-11", locale: en).isToday)
        XCTAssertEqual(HistoryRowFormat.badge(dateISO: "2026-10-05", todayISO: "2026-10-11", locale: en), .init(top: "5", bottom: "Oct"))
    }

    func test_chips_list_only_what_the_list_knows() {
        XCTAssertEqual(HistoryRowFormat.chips(hasNotes: nil, hasRx: true, hasPhotos: nil, bill: .paid, open: false), [.rx, .paid])
        XCTAssertEqual(HistoryRowFormat.chips(hasNotes: true, hasRx: false, hasPhotos: true, bill: .due, open: true), [.open, .notes, .photos, .due])
        XCTAssertEqual(HistoryRowFormat.chips(hasNotes: false, hasRx: false, hasPhotos: false, bill: .none, open: false), [])
    }

    func test_title_falls_back_complaint_then_procedure_then_kind_then_visit() {
        XCTAssertEqual(HistoryRowFormat.title(complaint: "Toothache", procedure: "RCT", kind: .walkIn), "Toothache")
        XCTAssertEqual(HistoryRowFormat.title(complaint: "  ", procedure: "RCT", kind: .walkIn), "RCT")
        XCTAssertEqual(HistoryRowFormat.title(complaint: nil, procedure: " ", kind: .appointment), p9("p9.title.appointment"))
        XCTAssertEqual(HistoryRowFormat.title(complaint: nil, procedure: nil, kind: .walkIn), p9("p9.title.walkin"))
        XCTAssertEqual(HistoryRowFormat.title(complaint: nil, procedure: nil, kind: nil), "Visit")
        XCTAssertFalse(HistoryRowFormat.title(complaint: nil, procedure: nil, kind: nil).hasPrefix("V-"))
    }

    func test_due_shows_only_with_money_and_a_balance() {
        XCTAssertEqual(HistoryRowFormat.dueText(duePaise: 600_000, moneyVisible: true), ClinicFormat.rupees(paise: 600_000))
        XCTAssertNil(HistoryRowFormat.dueText(duePaise: 600_000, moneyVisible: false))
        XCTAssertNil(HistoryRowFormat.dueText(duePaise: 0, moneyVisible: true))
        XCTAssertNil(HistoryRowFormat.dueText(duePaise: nil, moneyVisible: true))
        // An assistant's list carries no due at all, so the card falls back to the plain chip.
        XCTAssertEqual(HistoryRowFormat.chips(hasNotes: nil, hasRx: false, hasPhotos: nil, bill: .due, open: false, duePaise: nil), [.due])
        let amount = HistoryRowFormat.chips(hasNotes: nil, hasRx: false, hasPhotos: nil, bill: .due, open: false, duePaise: 600_000)
        XCTAssertEqual(amount, [.dueAmount(ClinicFormat.rupees(paise: 600_000))])
        XCTAssertTrue(amount[0].title.contains(ClinicFormat.rupees(paise: 600_000)))
    }

    func test_teeth_chips_come_first_after_open_and_read_as_teeth() {
        let chips = HistoryRowFormat.chips(hasNotes: nil, hasRx: true, hasPhotos: nil, bill: .paid, open: true, teeth: [26, 36])
        XCTAssertEqual(chips, [.open, .tooth(26), .tooth(36), .rx, .paid])
        XCTAssertEqual(chips[1].title, "26")
        XCTAssertEqual(chips[1].spoken, p9f("p9.chip.tooth.a11y", 26))
        XCTAssertEqual(HistoryRowFormat.chips(hasNotes: nil, hasRx: false, hasPhotos: nil, bill: .none, open: false, teeth: []), [])
    }

    func test_dose_grid_reads_the_frequency_and_totals_the_tablets() {
        let d = DoseDisplay.make(frequency: "1-0-1", timing: "after_food", days: 5, form: "tablet")
        XCTAssertEqual(d.cells.map(\.value), ["1", "0", "1"])
        XCTAssertEqual(d.cells.map(\.on), [true, false, true])
        XCTAssertEqual(d.frequency, "1-0-1")
        XCTAssertEqual(d.total, "10 tablets")
        XCTAssertEqual(d.timing, "After food")
        XCTAssertEqual(d.days, "5 days")
    }

    func test_dose_grid_shows_halves_and_sos_as_up_to() {
        let d = DoseDisplay.make(frequency: "½-0-½", timing: "sos", days: 3, form: "tablet")
        XCTAssertEqual(d.cells.map(\.value), ["½", "0", "½"])
        XCTAssertEqual(d.total, "Up to 3 tablets")
    }

    func test_dose_grid_for_an_unreadable_frequency_keeps_the_text_and_no_total() {
        let d = DoseDisplay.make(frequency: "twice a day", timing: nil, days: 5, form: "syrup")
        XCTAssertEqual(d.cells.map(\.value), ["–", "–", "–"])
        XCTAssertEqual(d.frequency, "twice a day")
        XCTAssertNil(d.total)
    }
}
