import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// "Send on WhatsApp" on the Done screen (visit story C2–C3): the server builds the patient's summary
/// and the doctor sends it from their own WhatsApp. The message stays in the holder's memory only. The
/// screen says "prepared", never "sent": we can't see WhatsApp.
struct DoctorWhatsAppSummary: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let visitId: String

    var body: some View {
        ScreenHost(make: { graph.whatsAppSummary(clinic: clinic, visitId: visitId, screen: $0) }, state: { $0.state }) { holder, state in
            if holder.visible { WhatsAppSummaryCard(holder: holder, state: state) }
        }
    }
}

enum WhatsAppSummaryText {
    static func refusal(_ reason: SummaryRefusal) -> String {
        switch reason {
        case .visitOpen: dv10("dv10.wa.visit_open")
        case .noPhone: dv10("dv10.wa.no_phone")
        case .noConsent: dv10("dv10.wa.no_consent")
        case .optedOut: dv10("dv10.wa.opted_out")
        case .noWhatsApp: dv10("dv10.wa.no_whatsapp")
        }
    }

    static func prepared(minute: Int, guardian: Bool, autoMinute: Int?) -> String {
        let clock = TodayV7.clock(minuteOfDay: minute)
        let line = guardian ? dv10f("dv10.wa.prepared_guardian", clock) : dv10f("dv10.wa.prepared", clock)
        guard let autoMinute else { return line }
        return line + " " + dv10f("dv10.wa.auto", TodayV7.clock(minuteOfDay: autoMinute))
    }
}

private struct WhatsAppSummaryCard: View {
    let holder: WhatsAppSummaryStateHolder
    let state: WhatsAppSummaryState
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            Text(dv10("dv10.wa.title")).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
            switch onEnum(of: state) {
            case .prepared(let prepared):
                Text(WhatsAppSummaryText.prepared(
                    minute: Int(prepared.preparedMinute), guardian: prepared.forGuardian,
                    autoMinute: prepared.autoSentMinute.map { Int(truncating: $0) }
                ))
                .v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
                .accessibilityAddTraits(.updatesFrequently)
                SkPillButton(dv10("dv10.wa.again"), variant: .tonal, icon: V7Icon.path("wa"), wide: true) { open(prepared.handoff) }
            default:
                Text(dv10("dv10.wa.hint")).v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
                let preparing = state is WhatsAppSummaryStatePreparing
                SkPillButton(dv10(preparing ? "dv10.wa.preparing" : "dv10.wa.send"), variant: .tonal, icon: V7Icon.path("wa"), wide: true) {
                    send()
                }
                .disabled(preparing)
                if let problem = problem {
                    Text(problem).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var problem: String? {
        switch onEnum(of: state) {
        case .refused(let refused): WhatsAppSummaryText.refusal(refused.reason)
        case .failed(let failed): failed.error.message
        default: nil
        }
    }

    /// Asks the server only when WhatsApp is there to take the message.
    private func send() {
        guard let probe = URL(string: "whatsapp://"), UIApplication.shared.canOpenURL(probe) else {
            holder.whatsAppMissing()
            return
        }
        Task { @MainActor in
            if let handoff = try? await holder.prepareNow() { open(handoff) }
        }
    }

    private func open(_ handoff: WhatsAppHandoff) {
        guard let url = URL(string: handoff.appLink) else { holder.whatsAppMissing(); return }
        openURL(url) { accepted in if !accepted { holder.whatsAppMissing() } }
    }
}
