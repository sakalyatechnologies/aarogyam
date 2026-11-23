import XCTest

/// App Review screen recording (Guideline 2.1): drives the installed store app (com.aarogyam.ios) on a phone while
/// the founder records the screen. Sign-in uses the demo account from the environment
/// (`TEST_RUNNER_REVIEW_EMAIL`, `TEST_RUNNER_REVIEW_PASSWORD`); nothing is committed. Skipped when they are unset.
/// Account deletion is opened and then cancelled, so the review account stays.
final class ReviewWalkthroughTests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    func testReviewWalkthrough() throws {
        guard let email = env["REVIEW_EMAIL"], let password = env["REVIEW_PASSWORD"] else {
            throw XCTSkip("REVIEW_EMAIL / REVIEW_PASSWORD not set")
        }
        app = XCUIApplication(bundleIdentifier: env["REVIEW_BUNDLE"] ?? "com.aarogyam.ios")
        app.terminate()
        pause(3)
        app.launch()
        pause(3)
        signIn(email: email, password: password)
        dismissPrompts()

        // Today: the day at a glance.
        tab("Today")
        pause(4)
        app.swipeUp()
        pause(2)
        app.swipeDown()
        pause(2)

        // Patients: search, open a patient, history.
        if tab("Patients") {
            let search = app.searchFields.firstMatch.exists ? app.searchFields.firstMatch : app.textFields.firstMatch
            if search.waitForExistence(timeout: 5) {
                search.tap()
                search.typeText("98")
                pause(3)
                let first = app.cells.firstMatch.exists ? app.cells.firstMatch : app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "98")).firstMatch
                if first.waitForExistence(timeout: 8) {
                    first.tap()
                    pause(4)
                    tapIfPresent(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "History")).firstMatch)
                    pause(3)
                    app.swipeUp()
                    pause(3)
                    back()
                }
            }
        }

        // Waiting list: send in, start a visit, notes and a prescription, wrap up.
        if tab("Today") || tab("Queue") {
            pause(2)
            tapIfPresent(beginning("Send in token"))
            pause(2)
            if tapIfPresent(beginning("Start visit")) {
                pause(4)
                if let notes = [app.textViews.firstMatch, app.textFields.firstMatch].first(where: { $0.exists }) {
                    notes.tap()
                    notes.typeText("Tooth pain lower right for 3 days. Advised review.")
                    tapIfPresent(app.buttons["Done"])
                    pause(2)
                }
                if tapIfPresent(scrolledTo(app.buttons["Write prescription"])) {
                    pause(2)
                    tapIfPresent(beginning("Add set"))
                    pause(3)
                }
                if tapIfPresent(scrolledTo(app.buttons["Wrap up this visit"])) {
                    pause(3)
                    tapIfPresent(beginning("Finish"))
                    pause(3)
                }
            }
        }

        // Payment: collect for a waiting or finished patient.
        if tapIfPresent(beginning("Collect")) {
            pause(4)
            back()
        }

        // Account deletion: show it, then cancel.
        if tab("More") {
            pause(2)
            if tapIfPresent(scrolledTo(beginning("Delete account"))) {
                pause(4)
                if tapIfPresent(scrolledTo(app.buttons["Delete account"].firstMatch)) {
                    pause(3)
                    tapIfPresent(app.buttons["Cancel"])
                }
                pause(2)
                tapIfPresent(app.buttons["Close"])
                tapIfPresent(app.buttons["Cancel"])
            }
        }
        pause(3)
    }

    private func signIn(email: String, password: String) {
        if app.tabBars.firstMatch.waitForExistence(timeout: 5) { return }
        tapIfPresent(app.buttons["Sign in"].firstMatch)
        guard tapIfPresent(app.buttons["Use a password"], timeout: 15) else { return }
        pause(1)
        let field = app.textFields.firstMatch
        if field.waitForExistence(timeout: 5) {
            field.tap()
            if let old = field.value as? String, old.contains("@") {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
            }
            field.typeText(email)
        }
        let secret = app.secureTextFields.firstMatch
        if secret.waitForExistence(timeout: 5) {
            secret.tap()
            secret.typeText(password)
        }
        pause(1)
        tapIfPresent(app.buttons["Sign in"].firstMatch)
        _ = app.tabBars.firstMatch.waitForExistence(timeout: 30)
        pause(2)
    }

    private func dismissPrompts() {
        for label in ["Not now", "Don’t Allow", "Don't Allow", "Allow"] {
            tapIfPresent(app.buttons[label], timeout: 3)
        }
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "Don’t Allow"] where springboard.buttons[label].exists {
            springboard.buttons[label].tap()
        }
    }

    @discardableResult
    private func tab(_ name: String) -> Bool {
        tapIfPresent(app.tabBars.buttons[name], timeout: 5)
    }

    private func beginning(_ text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH[c] %@", text)).firstMatch
    }

    private func back() {
        let bar = app.navigationBars.buttons.firstMatch
        if bar.exists { bar.tap() } else { app.swipeRight() }
        pause(2)
    }

    @discardableResult
    private func tapIfPresent(_ element: XCUIElement, timeout: TimeInterval = 6) -> Bool {
        guard element.waitForExistence(timeout: timeout), element.isHittable else { return false }
        element.tap()
        return true
    }

    private func scrolledTo(_ element: XCUIElement) -> XCUIElement {
        for _ in 0..<6 where !(element.exists && element.isHittable) { app.swipeUp() }
        return element
    }

    private func pause(_ seconds: UInt32) { sleep(seconds) }
}
