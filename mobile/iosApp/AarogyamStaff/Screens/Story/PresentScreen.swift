import AarogyamShared
import SakalyaUI
import SwiftUI
import WebKit

/// Show patient (design §1.12): the visit's mouth view full screen, drawn by the story bundle as on
/// the web. Back goes "Back to all teeth" first (board, then map), then closes; the page's
/// hold-to-exit closes too.
struct PresentScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let visitId: String

    var body: some View {
        ScreenHost(make: { graph.present(clinic: clinic, visitId: visitId, screen: $0) }, state: { $0.state }) { holder, state in
            PresentBody(holder: holder, state: state)
        }
    }
}

private struct PresentBody: View {
    let holder: PresentStateHolder
    let state: PresentState
    @State private var webView: WKWebView?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @Environment(\.skTheme) private var theme

    var body: some View {
        ZStack(alignment: .topLeading) {
            theme.roles.background.color.ignoresSafeArea()
            StoryWebView(onMessage: { holder.onPageMessage(text: $0) }, webView: $webView)
                .ignoresSafeArea(edges: .bottom)
            overlay
            Button(action: back) {
                Image(systemName: "chevron.left").font(.body.weight(.semibold)).frame(width: 44, height: 44)
            }
            .skGlassButton()
            .accessibilityLabel(CL("c.present.back"))
            .padding(.leading, SkSpacing.l)
        }
        .task(id: webView == nil) {
            guard let webView else { return }
            for await script in holder.scripts { webView.evaluateJavaScript(script, completionHandler: nil) }
        }
        .task {
            for await event in holder.events {
                if case .exit = onEnum(of: event) { dismiss() }
            }
        }
        .onAppear { holder.setDark(dark: scheme == .dark) }
        .onChange(of: scheme) { _, now in holder.setDark(dark: now == .dark) }
    }

    @ViewBuilder private var overlay: some View {
        switch onEnum(of: state) {
        case .showing:
            EmptyView()
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed:
            notice(CL("c.present.failed"), retry: true)
        case .unsupported:
            notice(CL("c.present.unsupported"), retry: false)
        }
    }

    private func notice(_ text: String, retry: Bool) -> some View {
        VStack(spacing: SkSpacing.l) {
            Text(text).multilineTextAlignment(.center).foregroundStyle(theme.roles.onSurface.color)
            if retry { SkPillButton(CL("c.present.retry")) { holder.refresh() } }
            SkPillButton(CL("c.present.close"), variant: .tonal) { dismiss() }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.roles.background.color)
    }

    /// Board, then map, then out: the page answers false once it is at the overview.
    private func back() {
        guard let webView, case .showing = onEnum(of: state) else { return dismiss() }
        webView.evaluateJavaScript(StoryBridge.shared.BACK) { answer, _ in
            let text = (answer as? Bool).map { $0 ? "true" : "false" } ?? (answer as? String)
            if !StoryBridge.shared.wentBack(answer: text) { dismiss() }
        }
    }
}
