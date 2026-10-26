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

/// "Clinic QR": the clinic's public booking page as a code patients scan, with the link beneath.
struct ClinicQRSheet: View {
    let url: String?
    let clinicName: String
    @Environment(\.skTheme) private var theme
    @State private var copied = false

    var body: some View {
        let r = theme.roles
        SkSheetScaffold(String(localized: "t7.qr.title", table: "TodayV7"), subtitle: clinicName) {
            if let url, let image = QRCode.image(for: url) {
                VStack(spacing: 14) {
                    Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                        .frame(maxWidth: 240).padding(16).background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .accessibilityLabel(String(localized: "t7.qr.code", table: "TodayV7"))
                    Text(String(localized: "t7.qr.message", table: "TodayV7")).skTextStyle(SkTypeScale.body)
                        .foregroundStyle(r.onSurfaceVariant.color).multilineTextAlignment(.center)
                    Text(url).font(.system(size: 12, design: .monospaced)).foregroundStyle(r.onSurface.color)
                        .multilineTextAlignment(.center).textSelection(.enabled)
                    HStack(spacing: 8) {
                        SkPillButton(String(localized: copied ? "t7.qr.copied" : "t7.qr.copy", table: "TodayV7"), variant: .tonal, wide: true) {
                            UIPasteboard.general.string = url
                            copied = true
                        }
                        if let link = URL(string: url) {
                            ShareLink(item: link) {
                                Text("t7.qr.share", tableName: "TodayV7").font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimary.color)
                                    .frame(maxWidth: .infinity, minHeight: 46).background(r.primary.color, in: Capsule())
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            } else {
                PreviewNotice(text: String(localized: "t7.qr.unavailable", table: "TodayV7"))
            }
        }
        .skSheet()
    }
}

/// The bell's sheet: booking notifications, newest first, with "Mark all read".
struct NotificationsSheet: View {
    let holder: NotificationsStateHolder
    let state: ListState
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        SkSheetScaffold(String(localized: "t7.notifications", table: "TodayV7")) {
            switch onEnum(of: state) {
            case .loading:
                SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity)
            case .notAllowed:
                Text("today.not_allowed.message").skTextStyle(SkTypeScale.footnote).foregroundStyle(r.onSurfaceVariant.color)
            case .failed(let failed):
                Text(failed.error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color)
            case .loaded(let loaded):
                let items = loaded.items.compactMap { $0 as? AlertRow }
                if items.isEmpty {
                    Text("t7.notifications.none", tableName: "TodayV7").skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(items.prefix(30).enumerated()), id: \.offset) { _, row in
                            NotificationKindRow(row: row)
                        }
                        if items.contains(where: { !$0.read }) {
                            SkPillButton(String(localized: "t7.notifications.read_all", table: "TodayV7"), variant: .tonal, wide: true) { holder.readAll() }
                        }
                    }
                }
            }
        }
        .skSheet()
    }
}
