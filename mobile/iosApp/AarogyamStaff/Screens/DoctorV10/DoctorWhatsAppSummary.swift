import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// "Send on WhatsApp" on the Done screen (visit story C2–C3): the server builds the patient's summary
/// and the doctor sends it from their own WhatsApp. The message stays in the holder's memory only. The
/// screen says "prepared", never "sent": we can't see WhatsApp.
///
/// [compact] is the queue board's finished card: one "Prepare WhatsApp summary" button and its status.
struct DoctorWhatsAppSummary: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let visitId: String
    var compact = false

    var body: some View {
        ScreenHost(make: { graph.whatsAppSummary(clinic: clinic, visitId: visitId, screen: $0) }, state: { $0.state }) { holder, state in
            if holder.visible { WhatsAppSummaryCard(holder: holder, state: state, compact: compact) }
        }
        .id(visitId)
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
    let compact: Bool
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme
    @State private var ticks: MessageTicks?
    @State private var choosing = false

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            if !compact { Text(dv10("dv10.wa.title")).v7Text(14, .bold).foregroundStyle(r.onSurface.color) }
            switch onEnum(of: state) {
            case .prepared(let prepared):
                Text(WhatsAppSummaryText.prepared(
                    minute: Int(prepared.preparedMinute), guardian: prepared.forGuardian,
                    autoMinute: prepared.autoSentMinute.map { Int(truncating: $0) }
                ))
                .v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
                .accessibilityAddTraits(.updatesFrequently)
                SkPillButton(dv10("dv10.wa.again"), variant: .tonal, icon: V7Icon.path("wa"), wide: !compact) { open(prepared.handoff) }
            default:
                if !compact { Text(dv10("dv10.wa.hint")).v7Text(13).foregroundStyle(r.onSurfaceVariant.color) }
                if let ticks, ticks.ticked != nil {
                    if !compact || choosing {
                        MessageTicksView(holder: holder, ticks: ticks)
                    } else {
                        Button(dv10("dv10.wa.choose")) { choosing = true }
                            .v7Text(12.5, .semibold).foregroundStyle(r.primary.color)
                    }
                }
                let preparing = state is WhatsAppSummaryStatePreparing
                let idle: String.LocalizationValue = compact ? "dv10.wa.prepare" : "dv10.wa.send"
                SkPillButton(dv10(preparing ? "dv10.wa.preparing" : idle), variant: .tonal, icon: V7Icon.path("wa"), wide: !compact) {
                    send()
                }
                .disabled(preparing)
                if let problem = problem {
                    Text(problem).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: ObjectIdentifier(holder)) {
            for await next in holder.ticks { ticks = next }
        }
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
        openURL(url) { accepted in
            if accepted { holder.handedOff() } else { holder.whatsAppMissing() }
        }
    }
}

/// The ticks and the live preview, with the stand-in link and PIN greyed out. Saves nothing.
private struct MessageTicksView: View {
    let holder: WhatsAppSummaryStateHolder
    let ticks: MessageTicks
    @State private var whole = false
    @Environment(\.skTheme) private var theme

    private static let sections: [MessageSection] = [.done, .detail, .found, .plan, .medicines, .care, .offer]

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            Text(dv10("dv10.wa.ticks")).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
            SkChoiceChips(
                Self.sections,
                selected: Set(Self.sections.filter { ticks.isOn(section: $0) }),
                label: Self.label
            ) { section in holder.toggle(section: section, on: !ticks.isOn(section: section)) }
            let parts = ticks.previewParts
            if !parts.isEmpty {
                VStack(alignment: .leading, spacing: SkSpacing.xs) {
                    Text(preview(parts, muted: r.onSurfaceVariant.color))
                        .v7Text(12.5).foregroundStyle(r.onSurface.color)
                        .lineLimit(whole ? nil : 6)
                    Button(dv10(whole ? "dv10.wa.preview_less" : "dv10.wa.preview_more")) { whole.toggle() }
                        .v7Text(12.5, .semibold).foregroundStyle(r.primary.color)
                    Text(dv10("dv10.wa.stand_in")).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                }
                .padding(SkSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .onAppear { holder.showPreview() }
    }

    private func preview(_ parts: [PreviewPart], muted: Color) -> AttributedString {
        parts.reduce(into: AttributedString()) { text, part in
            var run = AttributedString(part.text)
            if part.standIn { run.foregroundColor = muted }
            text += run
        }
    }

    private static func label(_ section: MessageSection) -> String {
        switch section {
        case .done: dv10("dv10.wa.tick.done")
        case .detail: dv10("dv10.wa.tick.detail")
        case .found: dv10("dv10.wa.tick.found")
        case .plan: dv10("dv10.wa.tick.plan")
        case .medicines: dv10("dv10.wa.tick.medicines")
        case .care: dv10("dv10.wa.tick.care")
        case .offer: dv10("dv10.wa.tick.offer")
        }
    }
}
