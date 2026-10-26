import AarogyamShared
import PencilKit
import UIKit

/// `String(localized:)` from the IntakeV10 table.
func iv(_ key: String.LocalizationValue) -> String { String(localized: key, table: "IntakeV10") }

/// Pure helpers for the intake form (kept free of views so they can be tested).
enum IntakeV10Logic {
    static let maxPhotoBytes = 2_000_000
    static let maxPhotoEdge = 1280

    /// A JPEG of `data`, long edge at most 1280, at most 2 MB; nil when it can't be read or can't be made small enough.
    static func photoJPEG(from data: Data, maxEdge: Int = maxPhotoEdge, maxBytes: Int = maxPhotoBytes) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let image = UIImage(cgImage: cg)
        for quality in stride(from: 0.8, through: 0.2, by: -0.15) {
            if let out = image.jpegData(compressionQuality: quality), out.count <= maxBytes { return out }
        }
        return nil
    }

    /// The signature as PNG bytes on a white ground; nil when nothing was drawn.
    static func signaturePNG(_ drawing: PKDrawing, size: CGSize) -> Data? {
        guard !drawing.strokes.isEmpty, size.width > 0, size.height > 0 else { return nil }
        let rect = CGRect(origin: .zero, size: size)
        var ink = UIImage()
        UITraitCollection(userInterfaceStyle: .light).performAsCurrent { ink = drawing.image(from: rect, scale: 2) }
        let format = UIGraphicsImageRendererFormat(); format.scale = 2
        return UIGraphicsImageRenderer(size: size, format: format).pngData { ctx in
            UIColor.white.setFill(); ctx.fill(rect)
            ink.draw(in: rect)
        }
    }

    /// Digits typed into the date box, shown as `YYYY-MM-DD` (at most 8 digits).
    static func dateText(_ typed: String) -> String {
        let d = String(typed.filter(\.isNumber).prefix(8))
        var out = ""
        for (i, c) in d.enumerated() { if i == 4 || i == 6 { out.append("-") }; out.append(c) }
        return out
    }

    static func problemText(_ field: IntakeField, _ problem: IntakeProblem) -> String {
        switch (field, problem) {
        case (.consent, _): iv("iv.err.consent")
        case (.signature, _): iv("iv.err.signature")
        case (.birth, .inFuture): iv("iv.err.birth.future")
        case (.birth, .required): iv("iv.err.birth.required")
        case (_, .required): iv("iv.err.required")
        case (_, .inFuture): iv("iv.err.invalid")
        case (_, .invalid): iv("iv.err.invalid")
        }
    }

    /// Banner copy for a failed save; nil for offline, which has its own banner.
    static func submitText(_ error: IntakeSubmitError) -> String {
        switch onEnum(of: error) {
        case .needsConnection: iv("iv.offline")
        case .notWired: iv("iv.notwired")
        case .server(let s): s.error.message
        }
    }
}
