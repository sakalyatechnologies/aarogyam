import AarogyamShared
import SwiftUI
import UIKit

/// Talks to the text view behind a [FormattedTextEditor]: the toolbar applies a format to its selection.
@MainActor
final class EditorController {
    fileprivate weak var textView: UITextView?
    fileprivate var onChange: (String) -> Void = { _ in }

    /// Applies [format] to the selected text (or the lines it touches) and keeps the selection on the result.
    func apply(_ format: Format) {
        guard let view = textView else { return }
        let range = view.selectedRange
        // Kotlin and UIKit both count UTF-16 units, so the selection maps one to one.
        let done = RichTextKt.applyFormat(
            value: view.text,
            start: Int32(range.location),
            end: Int32(range.location + range.length),
            format: format
        )
        view.text = done.value
        view.selectedRange = NSRange(location: Int(done.start), length: Int(done.end - done.start))
        onChange(done.value)
    }
}

/// A plain text box whose selection the formatting toolbar can act on (SwiftUI's own editor can't report it before iOS 18).
struct FormattedTextEditor: UIViewRepresentable {
    let text: String
    let controller: EditorController
    let enabled: Bool
    let onChange: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onChange: onChange) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .secondarySystemBackground
        view.layer.cornerRadius = 10
        view.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        view.autocorrectionType = .default
        view.accessibilityIdentifier = "notes.summary.editor"
        view.text = text
        controller.textView = view
        controller.onChange = onChange
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.onChange = onChange
        controller.onChange = onChange
        view.isEditable = enabled
        // Only an outside change (not the user's own typing) replaces the text, so the cursor stays put.
        if view.text != text { view.text = text }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var onChange: (String) -> Void
        init(onChange: @escaping (String) -> Void) { self.onChange = onChange }
        func textViewDidChange(_ textView: UITextView) { onChange(textView.text) }
    }
}
