import AarogyamShared
import AudioToolbox
import SakalyaUI
import SwiftUI
import UIKit

/// The app-wide banner for a patient waiting, send in and collect payment. It shows over any tab for 6 seconds,
/// a tap dismisses it, VoiceOver is told, and with Reduce Motion it fades instead of sliding.
struct LiveBannerView: View {
    let holder: LiveBannerHolder
    let banner: LiveBanner?
    @State private var shown: LiveBanner?
    @State private var dismissTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ZStack {
            if let shown, let text = LiveV10Logic.text(kind: shown.kind, token: shown.tokenNumber?.intValue) {
                Button { close() } label: {
                    Text(text).v7Text(16, .bold).foregroundStyle(r.onPrimaryContainer.color)
                        .multilineTextAlignment(.leading)
                        .padding(SkSpacing.m).frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget, alignment: .leading)
                        .background(r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 14))
                        .shadow(radius: 4, y: 2)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, SkSpacing.l)
                .accessibilityLabel(text)
                .accessibilityHint(lv("lv10.dismiss"))
                .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(shown != nil)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.35), value: shown?.notificationId)
        .onChange(of: banner?.notificationId) { _, _ in if let banner { show(banner) } }
        .onDisappear { dismissTask?.cancel() }
    }

    private func show(_ banner: LiveBanner) {
        guard let text = LiveV10Logic.text(kind: banner.kind, token: banner.tokenNumber?.intValue) else { return }
        shown = banner
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        if banner.kind == "send_in" { AudioServicesPlaySystemSound(1007) }
        UIAccessibility.post(notification: .announcement, argument: text)
        dismissTask?.cancel()
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { close() }
        }
    }

    private func close() {
        dismissTask?.cancel()
        shown = nil
        holder.dismiss()
    }
}
