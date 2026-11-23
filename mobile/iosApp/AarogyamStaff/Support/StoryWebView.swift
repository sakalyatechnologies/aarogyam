import AarogyamShared
import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Serves the story bundle (the app's `story` resource folder) at `aarostory://story/...`, each file
/// with its own type, so the page's ES modules load as `text/javascript`.
final class StorySchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.url(forResource: "story", withExtension: nil)?.standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "story", let root else { return fail(task) }
        let parts = url.path.split(separator: "/").map(String.init).filter { $0 != "." && $0 != ".." }
        let file = parts.reduce(root) { $0.appendingPathComponent($1) }.standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file),
              let response = HTTPURLResponse(
                url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": Self.mime(file.pathExtension), "Content-Length": "\(data.count)",
                               "Access-Control-Allow-Origin": "*"]
              )
        else { return fail(task) }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "js", "mjs": "text/javascript"
        case "css": "text/css"
        case "html": "text/html; charset=utf-8"
        case "json": "application/json"
        case "svg": "image/svg+xml"
        case "wasm": "application/wasm"
        default: UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        }
    }

    private func fail(_ task: WKURLSchemeTask) { task.didFailWithError(URLError(.fileDoesNotExist)) }
}

/// The story page in a WebView: messages on the `aarogyam` channel go to [onMessage] as JSON text.
struct StoryWebView: UIViewRepresentable {
    let onMessage: (String) -> Void
    @Binding var webView: WKWebView?

    func makeCoordinator() -> Coordinator { Coordinator(onMessage: onMessage) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(StorySchemeHandler(), forURLScheme: StoryBridge.shared.IOS_SCHEME)
        config.userContentController.add(context.coordinator, name: StoryBridge.shared.CHANNEL)
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        if let entry = URL(string: StoryBridge.shared.IOS_ENTRY) { view.load(URLRequest(url: entry)) }
        DispatchQueue.main.async { webView = view }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: StoryBridge.shared.CHANNEL)
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        let onMessage: (String) -> Void
        init(onMessage: @escaping (String) -> Void) { self.onMessage = onMessage }

        /// The page posts a JSON string; an object is turned back into JSON text for the same parser.
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            if let text = message.body as? String {
                onMessage(text)
            } else if JSONSerialization.isValidJSONObject(message.body),
                      let data = try? JSONSerialization.data(withJSONObject: message.body),
                      let text = String(data: data, encoding: .utf8) {
                onMessage(text)
            }
        }
    }
}
