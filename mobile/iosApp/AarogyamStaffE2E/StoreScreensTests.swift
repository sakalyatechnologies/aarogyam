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
        app.launch()
    }

    func testDoctorToday() throws {
        launch(as: doctor)
        wait(app.tabBars.buttons["Today"], timeout: 30)
        sleep(4)
        shot("1-doctor-today")
    }

    func testDeskHome() throws {
        launch(as: desk)
        wait(app.tabBars.buttons["Today"], timeout: 30)
        sleep(4)
        shot("2-desk-home")
    }

    func testPatient() throws {
        guard let id = env["STORE_PATIENT"] else { throw XCTSkip("STORE_PATIENT not set") }
        launch(as: doctor, extra: ["AAROGYAM_DEV_PATIENT": id])
        sleep(6)
        shot("3-patient-overview")
        let history = app.buttons.containing(NSPredicate(format: "label == %@", "History")).firstMatch
        if history.waitForExistence(timeout: 5) {
            history.tap()
            sleep(2)
            shot("4-patient-history")
        }
    }

    func testLabs() throws {
        launch(as: owner)
        openMore("Lab work")
        let late = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "LAB-1")).firstMatch
        wait(late, timeout: 20)
        shot("6-labs-list")
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
        shot("8-chat-list")
        everyone.tap()
        wait(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "staff meeting")).firstMatch, timeout: 20)
        sleep(1)
        shot("7-chat-thread")
    }

    // MARK: helpers

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
