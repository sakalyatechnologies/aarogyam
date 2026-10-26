import AarogyamShared
import PencilKit
import UIKit
import XCTest
@testable import AarogyamStaff

final class IntakeV10Tests: XCTestCase {
    private func bigImage() -> Data {
        let r = UIGraphicsImageRenderer(size: CGSize(width: 3000, height: 2000))
        return r.jpegData(withCompressionQuality: 1) { ctx in
            for i in 0..<400 {
                UIColor(hue: CGFloat(i % 50) / 50, saturation: 1, brightness: 1, alpha: 1).setFill()
                ctx.fill(CGRect(x: i * 7 % 3000, y: i * 13 % 2000, width: 200, height: 200))
            }
        }
    }

    func testPhotoIsResizedAndUnderTwoMegabytes() throws {
        let out = try XCTUnwrap(IntakeV10Logic.photoJPEG(from: bigImage()))
        XCTAssertLessThanOrEqual(out.count, 2_000_000)
        let image = try XCTUnwrap(UIImage(data: out))
        XCTAssertLessThanOrEqual(max(image.size.width * image.scale, image.size.height * image.scale), 1280)
    }

    func testUnreadablePhotoGivesNil() {
        XCTAssertNil(IntakeV10Logic.photoJPEG(from: Data([1, 2, 3])))
    }

    func testSignaturePNGNotEmpty() throws {
        let points = [PKStrokePoint(location: CGPoint(x: 10, y: 10), timeOffset: 0, size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: 0),
                      PKStrokePoint(location: CGPoint(x: 90, y: 60), timeOffset: 0.1, size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: 0)]
        let path = PKStrokePath(controlPoints: points, creationDate: Date())
        let drawing = PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: path)])
        let png = try XCTUnwrap(IntakeV10Logic.signaturePNG(drawing, size: CGSize(width: 100, height: 80)))
        XCTAssertFalse(png.isEmpty)
        XCTAssertNotNil(UIImage(data: png))
    }

    func testEmptySignatureIsNil() {
        XCTAssertNil(IntakeV10Logic.signaturePNG(PKDrawing(), size: CGSize(width: 100, height: 80)))
    }

    func testDateTextInsertsDashes() {
        XCTAssertEqual(IntakeV10Logic.dateText("19900415"), "1990-04-15")
        XCTAssertEqual(IntakeV10Logic.dateText("1990-0"), "1990-0")
        XCTAssertEqual(IntakeV10Logic.dateText("199004159999"), "1990-04-15")
    }

    func testProblemTextMapping() {
        XCTAssertEqual(IntakeV10Logic.problemText(.birth, .inFuture), iv("iv.err.birth.future"))
        XCTAssertEqual(IntakeV10Logic.problemText(.consent, .required), iv("iv.err.consent"))
        XCTAssertEqual(IntakeV10Logic.problemText(.name, .required), iv("iv.err.required"))
        XCTAssertEqual(IntakeV10Logic.problemText(.email, .invalid), iv("iv.err.invalid"))
        XCTAssertFalse(iv("iv.save").isEmpty)
    }

    func testSubmitTextMapping() {
        XCTAssertEqual(IntakeV10Logic.submitText(IntakeSubmitErrorNeedsConnection.shared), iv("iv.offline"))
        XCTAssertEqual(IntakeV10Logic.submitText(IntakeSubmitErrorServer(error: .server)), ScreenError.server.message)
    }
}
