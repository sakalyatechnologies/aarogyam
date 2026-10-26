import AarogyamShared
import XCTest
@testable import AarogyamStaff

@MainActor
final class AuthV7Tests: XCTestCase {
    func test_otp_boxes_show_typed_digits_and_point_at_the_next_box() {
        XCTAssertEqual(OtpBoxes.digit("482", at: 0), "4")
        XCTAssertEqual(OtpBoxes.digit("482", at: 2), "2")
        XCTAssertNil(OtpBoxes.digit("482", at: 3))
        XCTAssertEqual(OtpBoxes.current("", count: 8), 0)
        XCTAssertEqual(OtpBoxes.current("482", count: 8), 3)
        XCTAssertEqual(OtpBoxes.current("12345678", count: 8), 7)
    }

    func test_invite_urls_are_taken_only_for_the_app_scheme_and_a_valid_token() {
        let app = AppModel()
        let token = "abcdefghijklmnopqrstuvwxyz012345"
        app.handle(url: URL(string: "aarogyam://invite#\(token)")!)
        XCTAssertEqual(app.pendingInvite, "aarogyam://invite#\(token)")
        let other = AppModel()
        other.handle(url: URL(string: "https://example.com/invite#\(token)")!)
        other.handle(url: URL(string: "aarogyam://invite#short")!)
        other.handle(url: URL(string: "aarogyam://patients#\(token)")!)
        XCTAssertNil(other.pendingInvite)
    }

    func test_a_held_invitation_skips_the_welcome_pager() {
        XCTAssertEqual(SignedOutFlow.firstStep(hasInvite: true), .signIn)
        XCTAssertEqual(SignedOutFlow.firstStep(hasInvite: false), .welcome)
    }

    func test_registration_updates_change_only_the_field_given() {
        let start = RegistrationState(
            clinicName: "A", city: "B", contactName: "C", email: "d@e.f", phone: "", specialty: .dental,
            message: "", invalid: [], sending: false, error: nil, received: false
        )
        let next = start.updating(city: "Pune", specialty: .general)
        XCTAssertEqual(next.city, "Pune")
        XCTAssertEqual(next.clinicName, "A")
        XCTAssertEqual(next.email, "d@e.f")
        XCTAssertEqual(next.specialty, .general)
    }

    func test_welcome_art_exists_for_every_slide() {
        for name in ["tooth", "family", "implant"] { XCTAssertNotNil(IllustrationArt.shared.all[name], name) }
    }
}
