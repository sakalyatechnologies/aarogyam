import XCTest

/// Store and review screenshots against the local API with synthetic data (docs/release.md). Each test opens
/// one area as the seeded owner and attaches named screenshots; `scripts/store-shots.sh` exports them.
final class StoreScreensTests: XCTestCase {
    private let owner = "a1a1a1a1-0000-4000-8000-000000000001"
    private let doctor = "a1a1a1a1-0000-4000-8000-000000000002"
    private let desk = "a1a1a1a1-0000-4000-8000-000000000003"
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(as person: String, extra: [String: String] = [:]) {
        app = XCUIApplication()
        app.launchEnvironment = [
            "AAROGYAM_DEV_SIGN_OUT": "1",
            "AAROGYAM_DEV_SIGN_IN": person,
            "AAROGYAM_DEV_CLINIC": "sunrise",
        ].merging(extra) { $1 }
        // A dev sign-in sometimes stops at the welcome screen or the clinic list on a first launch: try again.
        for _ in 0..<3 {
            app.launch()
            let clinic = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Sunrise Dental")).firstMatch
            if clinic.waitForExistence(timeout: 3), !app.tabBars.firstMatch.exists { clinic.tap() }
            if app.tabBars.firstMatch.waitForExistence(timeout: 25) { break }
            app.terminate()
        }
        // The one-time alerts prompt covers the first screen; the store shots show the app, not the prompt.
        let notNow = app.buttons["Not now"]
        if notNow.waitForExistence(timeout: 8) { notNow.tap() }
    }

    func testDoctorToday() throws {
        launch(as: doctor)
        wait(app.tabBars.buttons["Today"], timeout: 30)
        sleep(4)
        shot("1-doctor-today")
    }

    /// The doctor sends in the seeded patient's token and starts the visit, then adds a medicine set inline.
    func testZDoctorVisit() throws {
        guard let token = env["STORE_TOKEN"] else { throw XCTSkip("STORE_TOKEN not set") }
        launch(as: doctor)
        wait(app.buttons["Send in token \(token)"], timeout: 30).tap()
        wait(app.buttons["Start visit for token \(token)"], timeout: 15).tap()
        _ = wait(app.buttons["Wrap up this visit"], timeout: 20)
        scrolledTo(app.buttons["Write prescription"]).tap()
        scrolledTo(wait(app.buttons["Add set Dental pain, 2 medicines"], timeout: 15)).tap()
        // One medicine keeps the dose grid whole on screen; then park the prescription header just under the top bar.
        scrolledTo(wait(app.buttons["Remove Pantoprazole"])).tap()
        let header = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Write prescription")).firstMatch
        wait(header)
        let height = app.windows.firstMatch.frame.height
        for _ in 0..<12 {
            let delta = header.frame.minY - height * 0.15
            if abs(delta) < height * 0.03 { break }
            let step = max(-0.3, min(0.3, delta / height))
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6 - step))
            from.press(forDuration: 0.05, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 0.4)
            usleep(500_000)
        }
        sleep(1)
        shot("2-visit-rx")
    }

    func testDeskHome() throws {
        launch(as: desk)
        wait(app.tabBars.buttons["Today"], timeout: 30)
        sleep(4)
        // The phone-number pad is up on the desk home; a tap on the title puts it away.
        let title = app.staticTexts["Waiting"].firstMatch
        if title.exists { title.tap() } else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap() }
        let attempts: [() -> Void] = [
            { self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.05, thenDragTo: self.app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97))) },
            { self.app.swipeDown() },
            { self.app.staticTexts["Mobile number"].firstMatch.tap() },
        ]
        for attempt in attempts where app.keyboards.count > 0 {
            attempt()
            sleep(1)
        }
        sleep(1)
        shot("4-desk-board")
    }

    func testAPatient() throws {
        guard let id = env["STORE_PATIENT"] else { throw XCTSkip("STORE_PATIENT not set") }
        launch(as: doctor, extra: ["AAROGYAM_DEV_PATIENT": id])
        sleep(6)
        shot("3-patient-overview")
        let history = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "History")).firstMatch
        if history.waitForExistence(timeout: 5) {
            history.tap()
            sleep(2)
            shot("7-patient-history")
        }
    }

    func testLabs() throws {
        launch(as: owner)
        openMore("Lab work")
        let late = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "LAB-1")).firstMatch
        wait(late, timeout: 20)
        shot("5-labs-list")
        late.tap()
        sleep(2)
        shot("5-labs-case")
    }

    func testChat() throws {
        launch(as: owner)
        openMore("Team")
        wait(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "Team chat")).firstMatch, timeout: 20).tap()
        let everyone = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] %@", "Everyone")).firstMatch
        wait(everyone, timeout: 20)
        shot("6-chat-list")
        everyone.tap()
        wait(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "staff meeting")).firstMatch, timeout: 20)
        sleep(1)
        shot("6-chat-thread")
    }

    // MARK: helpers

    /// Swipes up until the element can be tapped (at most eight times).
    @discardableResult
    private func scrolledTo(_ element: XCUIElement) -> XCUIElement {
        for _ in 0..<8 where !(element.exists && element.isHittable) { app.swipeUp() }
        return element
    }

    private func openMore(_ tile: String) {
        wait(app.tabBars.buttons["More"], timeout: 30).tap()
        let button = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", tile)).firstMatch
        wait(button)
        button.tap()
    }

    @discardableResult
    private func wait(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        if !element.waitForExistence(timeout: timeout) {
            shot("missing")
            XCTFail("not found: \(element)", file: file, line: line)
        }
        return element
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
