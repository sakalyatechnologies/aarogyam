import AarogyamShared
import CoreImage.CIFilterBuiltins
import SakalyaUI
import SwiftUI

/// Draws a QR code for a link with the system's CoreImage generator (no encoder in the kit).
enum QRCode {
    /// A crisp, black-on-white image of [text], scaled up from the generator's one-point modules.
    static func image(for text: String, scale: CGFloat = 10) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cg = CIContext().createCGImage(output, from: output.extent)
        else { return nil }
        return UIImage(cgImage: cg)
    }
}
