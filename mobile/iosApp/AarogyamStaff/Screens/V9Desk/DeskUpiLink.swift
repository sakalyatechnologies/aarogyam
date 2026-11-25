import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Send UPI link" for a bill (BK-13): fetches the link, opens the share sheet with its text and
/// shows the QR beneath so the patient can scan it at the desk.
struct UpiLinkSection: View {
    let holder: UpiLinkHolder
    let due: DueBill
    @State private var state: UpiLinkState = UpiLinkStateIdle.shared
    @State private var sharing = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        if holder.canSend(due: due) {
            VStack(spacing: 8) {
                SkPillButton(dv("d9.pay.upi.send"), variant: .tonal, wide: true, loading: isLoading) { holder.send(invoiceId: due.id) }
                if case .failed = onEnum(of: state) {
                    Text(dv("d9.pay.upi.failed")).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if case .ready(let ready) = onEnum(of: state) {
                    if let image = QRCode.image(for: ready.share.qrData) {
                        Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 200, height: 200).padding(12)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .accessibilityLabel(dv("d9.pay.upi.qr"))
                    }
                    SkPillButton(dv("d9.pay.upi.share_again"), variant: .tonal, wide: true) { sharing = true }
                }
            }
            .task { for await next in holder.state { state = next; if case .ready = onEnum(of: next) { sharing = true } } }
            .sheet(isPresented: $sharing) {
                if case .ready(let ready) = onEnum(of: state) {
                    ActivityView(text: ready.share.text).presentationDetents([.medium, .large])
                }
            }
        }
    }

    private var isLoading: Bool { if case .loading = onEnum(of: state) { true } else { false } }
}

/// The system share sheet for a piece of text.
private struct ActivityView: UIViewControllerRepresentable {
    let text: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [text], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
