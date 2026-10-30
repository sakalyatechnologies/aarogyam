import XCTest

/// T12: one clinic visit across two phones, against the local API with synthetic data. Each test is one phase
/// on one simulator; `scripts/e2e-visit.sh` runs them in order (desk, doctor, desk) and passes the number and
/// the token between them through `TEST_RUNNER_E2E_*`. Each step prints `E2E step <name> <seconds> <taps>`.
final class VisitE2ETests: XCTestCase {
    private enum Person: String {
        case desk = "a1a1a1a1-0000-4000-8000-000000000003"
        case doctor = "a1a1a1a1-0000-4000-8000-000000000002"
    }

    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!
    private var taps = 0
    private var stepStart = Date()

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: phases

    /// Desk: look up a new number, register the patient with the intake form, and queue them for Dr Rao.
    func test1_deskRegistersAndQueues() throws {
        let phone = try XCTUnwrap(env["E2E_PHONE"], "set TEST_RUNNER_E2E_PHONE")
        launch(as: .desk)

        step("lookup") {
            let number = wait(app.textFields["Patient mobile number"])
            tap(number)
            number.typeText(phone)
            tap(wait(app.buttons["New patient"]))
        }

        step("intake") {
            type(wait(app.textFields["Full name"]), "E2E Test Patient")
            tap(app.buttons["Age"])
            type(wait(app.textFields["Age"]), "34")
            tap(scrolledTo(app.buttons["Female"]))
            tap(scrolledTo(app.buttons["None known"]))
            let notice = scrolledTo(app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Notice read'")).firstMatch)
            tap(notice.switches.firstMatch.exists ? notice.switches.firstMatch : notice)
            sign(scrolledTo(app.descendants(matching: .any)["intake.signature"]))
            tap(scrolledTo(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Rao'")).firstMatch))
            tap(scrolledTo(app.buttons["Save and add to queue"]))
        }

        let done = wait(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'added to the queue'")).firstMatch, timeout: 20)
        let token = try XCTUnwrap(done.label.split(separator: " ").dropFirst().first.map(String.init))
        print("E2E-TOKEN=\(token)")
        shot("desk-queued")
        tap(app.buttons["Next patient"])
    }

    /// Doctor: the patient shows on "Waiting for you"; Send in, Start visit, Wrap up with a fee, Send to desk.
    func test2_doctorSeesAndFinishes() throws {
        let token = try XCTUnwrap(env["E2E_TOKEN"], "set TEST_RUNNER_E2E_TOKEN")
        launch(as: .doctor)

        step("waiting-to-sent-in") {
            tap(wait(app.buttons["Send in token \(token)"], timeout: 30))
        }
        step("start-visit") {
            tap(wait(app.buttons["Start visit for token \(token)"], timeout: 15))
            _ = wait(app.buttons["Wrap up this visit"], timeout: 20)
        }
        shot("doctor-visit")
        step("wrap-up") {
            tap(app.buttons["Wrap up this visit"])
            let fee = wait(app.textFields["Fee (₹)"])
            tap(fee)
            if let text = fee.value as? String, !text.isEmpty, text != "Fee (₹)" {
                fee.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: text.count))
            }
            fee.typeText("500")
            tap(scrolledTo(app.buttons["Send to desk"]))
            _ = wait(app.buttons["Done"], timeout: 20)
        }
        shot("doctor-done")
        tap(app.buttons["Done"])
    }

    /// Desk: the visit is Ready to bill; collect ₹500 in cash, and the card leaves the board.
    func test3_deskCollects() throws {
        let token = try XCTUnwrap(env["E2E_TOKEN"], "set TEST_RUNNER_E2E_TOKEN")
        launch(as: .desk)

        // This token's card on the board ("Ready to bill, #N, name"); other patients may be waiting to pay too.
        let card = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH 'Ready to bill, #\(token),'")).firstMatch
        step("collect") {
            _ = wait(scrolledTo(card), timeout: 40)
            tap(card.buttons["Collect"])
            _ = wait(app.staticTexts["Collect payment"])
            tap(scrolledTo(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Cash'")).firstMatch))
            tap(scrolledTo(app.buttons["Record payment"]))
            _ = wait(app.staticTexts["Payment recorded"], timeout: 20)
        }
        shot("desk-paid")
        tap(app.buttons["Done"])
        // The settling payment moves the token to done, and closing the sheet reloads the board.
        XCTAssertTrue(waitGone(card, timeout: 10), "token \(token) is still Ready to bill")
        shot("desk-board-after")
    }

    // MARK: helpers

    private func launch(as person: Person) {
        app = XCUIApplication()
        app.launchEnvironment = [
            "AAROGYAM_DEV_SIGN_OUT": "1",
            "AAROGYAM_DEV_SIGN_IN": person.rawValue,
            "AAROGYAM_DEV_CLINIC": "sunrise",
        ]
        app.launch()
    }

    private func step(_ name: String, _ body: () -> Void) {
        taps = 0
        stepStart = Date()
        body()
        print(String(format: "E2E step %@ %.1f %d", name, Date().timeIntervalSince(stepStart), taps))
    }

    @discardableResult
    private func wait(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        if !element.waitForExistence(timeout: timeout) {
            shot("missing")
            XCTFail("not found: \(element)", file: file, line: line)
        }
        return element
    }

    private func waitGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }

    /// Swipes the form up until the element can be tapped (at most eight times).
    private func scrolledTo(_ element: XCUIElement) -> XCUIElement {
        for _ in 0..<8 where !(element.exists && element.isHittable) {
            app.swipeUp()
        }
        return element
    }

    private func tap(_ element: XCUIElement) {
        element.tap()
        taps += 1
    }

    private func type(_ field: XCUIElement, _ text: String) {
        tap(field)
        field.typeText(text)
    }

    /// A short zigzag across the pad, as a finger would sign.
    private func sign(_ pad: XCUIElement) {
        let start = pad.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.6))
        let middle = pad.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        let end = pad.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.7))
        start.press(forDuration: 0.05, thenDragTo: middle)
        middle.press(forDuration: 0.05, thenDragTo: end)
        taps += 1
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
