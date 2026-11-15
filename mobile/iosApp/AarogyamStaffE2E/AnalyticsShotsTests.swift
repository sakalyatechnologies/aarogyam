import XCTest

/// Screenshots of the Analytics page, My tasks and the notifications sheet against the local API
/// (synthetic data). Set `SHOT_DIR` (TEST_RUNNER_SHOT_DIR) to also write the PNGs to a folder.
final class AnalyticsShotsTests: XCTestCase {
    private let owner = "a1a1a1a1-0000-4000-8000-000000000001"
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch() {
        app = XCUIApplication()
        app.launchEnvironment = ["AAROGYAM_DEV_SIGN_OUT": "1", "AAROGYAM_DEV_SIGN_IN": owner, "AAROGYAM_DEV_CLINIC": "sunrise"]
        app.launch()
    }

    func testAnalyticsPage() throws {
        launch()
        let arrived = app.tabBars.buttons["Today"].waitForExistence(timeout: 60)
        shot("a0-launch")
        XCTAssertTrue(arrived)
        sleep(4)
        XCTAssertTrue(app.tabBars.buttons["More"].waitForExistence(timeout: 20))
        app.tabBars.buttons["More"].tap()
        let tile = app.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", "Analytics")).firstMatch
        XCTAssertTrue(tile.waitForExistence(timeout: 10))
        tile.tap()
        sleep(6)
        shot("a1-week-top")
        for index in 2...8 {
            app.swipeUp(velocity: .slow)
            sleep(1)
            shot("a\(index)-week-scroll")
        }
        for _ in 0..<8 { app.swipeDown(velocity: .fast) }
        let year = app.buttons["Year"]
        if year.waitForExistence(timeout: 5) {
            year.tap()
            sleep(5)
            shot("b1-year-top")
            app.swipeUp()
            sleep(1)
            shot("b2-year-scroll")
            for _ in 0..<4 { app.swipeDown(velocity: .fast) }
        }
        let custom = app.buttons["Custom"]
        if custom.waitForExistence(timeout: 5) {
            custom.tap()
            sleep(4)
            shot("c1-custom")
        }
    }

    func testTasksAndNotificationsHaveClose() throws {
        launch()
        XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: 40))
        sleep(4)
        let bell = app.buttons.containing(NSPredicate(format: "label CONTAINS[c] %@", "Notifications")).firstMatch
        if bell.waitForExistence(timeout: 5) {
            bell.tap()
            sleep(2)
            shot("n1-notifications")
            let close = app.buttons["sheet.close"]
            XCTAssertTrue(close.waitForExistence(timeout: 5), "notifications has a Close button")
            close.tap()
            sleep(1)
        }
        let tasks = app.buttons.containing(NSPredicate(format: "label BEGINSWITH[c] %@", "My tasks")).firstMatch
        if tasks.waitForExistence(timeout: 5) {
            tasks.tap()
            sleep(2)
            shot("t1-tasks")
            let close = app.buttons["sheet.close"]
            XCTAssertTrue(close.waitForExistence(timeout: 5), "My tasks has a Close button")
            close.tap()
            sleep(1)
        }
        shot("n2-after-close")
    }

    private func shot(_ name: String) {
        let screenshot = app.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["SHOT_DIR"] {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
        }
    }
}
