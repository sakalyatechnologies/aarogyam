import AarogyamShared
import SakalyaUI
import SwiftUI

/// How the patient's link goes out.
enum RxDeliveryChoice: CaseIterable {
    case whatsApp, sms, print

    var label: String {
        switch self {
        case .whatsApp: CL("c.rx.send.whatsapp")
        case .sms: CL("c.rx.send.sms")
        case .print: CL("c.rx.send.print")
        }
    }

    var icon: String? { self == .whatsApp ? "wa" : nil }

    /// The link and message in this channel: `wa.me` and `sms:` are real; Print waits for D9.
    func url(phone: String?, text: String) -> URL? {
        switch self {
        case .whatsApp: ClinicalFormat.whatsAppURL(phone: phone, text: text)
        case .sms: ClinicalFormat.smsURL(phone: phone, text: text)
        case .print: nil
        }
    }
}

/// After issuing: the PIN to read out, the delivery chips, "Send now", then the "Sent" result.
struct RxDelivery: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    let phone: String?
    let onDone: () -> Void
    @State private var choice: RxDeliveryChoice = .whatsApp
    @State private var sent = false
    @State private var cannotOpen = false
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    var body: some View {
        switch onEnum(of: state.share ?? ShareStateCreating.shared) {
        case .creating:
            SkLoadingIndicator(String(localized: "rx.link.creating")).frame(maxWidth: .infinity).padding(SkSpacing.l)
        case .failed(let failed):
            Text(failed.error.message).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.roles.error.color)
            SkPillButton(String(localized: "rx.share.retry"), wide: true) { holder.share() }
        case .ready(let ready):
            if sent { sentView } else { chooser(ready.link) }
        }
        if !sent { SkPillButton(String(localized: "done"), variant: .ghost, wide: true, action: onDone) }
    }

    private func chooser(_ link: ShareView) -> some View {
        let r = theme.roles
        let message = link.shareMessage(clinic: state.issued?.clinicName ?? "") + " " + link.url
        return VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
            SheetLine {
                VStack(alignment: .leading, spacing: 2) {
                    Text("rx.pin.label").font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
                    Text(link.pin).font(.system(size: 34, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                    Text("rx.pin.note").font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            if let masked = ClinicalFormat.maskedPhone(phone) {
                Text(CLf("c.rx.send.to", masked)).font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color)
            }
            ChipFlow {
                ForEach(RxDeliveryChoice.allCases, id: \.self) { option in
                    IconChoiceChip(text: option.label, icon: option.icon, selected: choice == option) { choice = option }
                }
            }
            if choice == .print { PreviewNotice(text: CL("c.rx.print.preview")) }
            SkPillButton(CL("c.rx.send.now"), variant: .warm, wide: true) { send(link, message) }
                .disabled(choice == .print)
            if cannotOpen { Text("c.rx.send.cannot", tableName: "ClinicalV7").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color) }
            if let url = URL(string: link.url) {
                ShareLink(item: url, subject: Text(String(localized: "rx.share.chooser")), message: Text(link.shareMessage(clinic: state.issued?.clinicName ?? ""))) {
                    Label(String(localized: "rx.share"), systemImage: "square.and.arrow.up")
                        .font(.system(size: 14, weight: .bold)).frame(maxWidth: .infinity, minHeight: 44)
                }
            }
        }
    }

    private var sentView: some View {
        VStack(spacing: SkSpacing.l) {
            SkCheckDraw()
            SkSheetHeader(CL("c.rx.sent.title"), subtitle: CL("c.rx.sent.message")).multilineTextAlignment(.center)
            SkPillButton(CL("c.done"), wide: true, action: onDone)
        }
        .frame(maxWidth: .infinity)
    }

    private func send(_ link: ShareView, _ message: String) {
        guard let url = choice.url(phone: phone, text: message) else { return }
        openURL(url) { accepted in
            sent = accepted
            cannotOpen = !accepted
        }
    }
}
