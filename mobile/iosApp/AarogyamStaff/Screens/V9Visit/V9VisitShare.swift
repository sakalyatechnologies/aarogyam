import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Share visit summary" on the closed visit: makes the seven-day link and PIN (`POST /visits/{id}/share`)
/// and sends them by WhatsApp (`wa.me`). The message holds the link and the PIN only, never the
/// patient's name; the PIN is shown once.
struct V9ShareSummary: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let visitId: String
    let phone: String?

    var body: some View {
        ScreenHost(make: { graph.visitShare(clinic: clinic, visitId: visitId, screen: $0) }, state: { $0.state }) { holder, state in
            V9ShareCard(holder: holder, state: state, phone: phone)
        }
    }
}

private struct V9ShareCard: View {
    let holder: VisitShareStateHolder
    let state: VisitShareState
    let phone: String?
    @State private var cannotOpen = false
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            switch onEnum(of: state) {
            case .idle:
                SkPillButton(V9("v9v.share.action"), variant: .tonal, icon: V7Icon.path("share"), wide: true) { holder.share() }
            case .creating:
                SkLoadingIndicator(V9("v9v.share.creating")).frame(maxWidth: .infinity)
            case .failed(let failed):
                Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                SkPillButton(String(localized: "try_again"), variant: .tonal, wide: true) { holder.share() }
            case .ready(let ready):
                V7Card {
                    VStack(alignment: .leading, spacing: SkSpacing.m) {
                        Text("v9v.share.pin", tableName: "VisitV9").v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        Text(ready.pin).font(.system(size: 34, weight: .heavy)).monospacedDigit().foregroundStyle(r.onSurface.color)
                        Text("v9v.share.note", tableName: "VisitV9").v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        SkPillButton(V9("v9v.share.whatsapp"), variant: .warm, icon: V7Icon.path("wa"), wide: true) { send(ready) }
                        if cannotOpen { Text("v9v.share.cannot", tableName: "VisitV9").v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                    }
                }
            }
        }
    }

    private func send(_ ready: VisitShareStateReady) {
        let text = V9f("v9v.share.message", ready.url, ready.pin)
        guard let url = ClinicalFormat.whatsAppURL(phone: phone, text: text) else { cannotOpen = true; return }
        openURL(url) { accepted in cannotOpen = !accepted }
    }
}
