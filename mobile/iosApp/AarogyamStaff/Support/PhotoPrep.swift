import AarogyamShared
import ImageIO
import UIKit

/// Shrinks a photo on the phone before it is sent: the longest side to the shared limit, upright,
/// re-encoded as a JPEG. Re-encoding drops the EXIF block, so the location and device details never leave the phone.
enum PhotoPrep {
    /// The JPEG for `data` (any image the phone can read), or nil when it can't be read.
    static func jpeg(from data: Data, maxEdge: Int = Int(PhotoLimits.shared.MAX_EDGE), quality: Double = Double(PhotoLimits.shared.JPEG_QUALITY) / 100) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image).jpegData(compressionQuality: quality)
    }
}

extension Data {
    /// The bytes as the shared code's array.
    var kotlinBytes: KotlinByteArray {
        let array = KotlinByteArray(size: Int32(count))
        for (index, byte) in enumerated() { array.set(index: Int32(index), value: Int8(bitPattern: byte)) }
        return array
    }
}

extension KotlinByteArray {
    var data: Data {
        Data((0..<Int(size)).map { UInt8(bitPattern: get(index: Int32($0))) })
    }
}
