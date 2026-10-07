import AarogyamShared
import SakalyaUI
import SwiftUI

/// Draws stored clinical text (the Markdown subset) with the app's own styles; nothing is interpreted as HTML.
struct RichTextView: View {
    let text: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.xs) {
            ForEach(Array(RichText.shared.parse(source: text).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func blockView(_ block: Block) -> some View {
        switch onEnum(of: block) {
        case .heading(let heading):
            Text(Self.attributed(heading.children))
                .skTextStyle(heading.level == 1 ? SkTypeScale.title : SkTypeScale.headline)
                .foregroundStyle(theme.palette.text.color)
        case .paragraph(let paragraph):
            Text(Self.attributed(paragraph.children)).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color)
        case .bullets(let bullets):
            ForEach(Array(bullets.items.enumerated()), id: \.offset) { _, item in row("•", item) }
        case .numbers(let numbers):
            ForEach(Array(numbers.items.enumerated()), id: \.offset) { index, item in row("\(index + 1).", item) }
        }
    }

    private func row(_ marker: String, _ inlines: [Inline]) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: SkSpacing.sm) {
            Text(marker).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color)
            Text(Self.attributed(inlines)).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color)
        }
    }

    /// Bold and italic runs as attributes on plain text.
    static func attributed(_ inlines: [Inline], intent: InlinePresentationIntent = []) -> AttributedString {
        var result = AttributedString()
        for inline in inlines {
            switch onEnum(of: inline) {
            case .text(let run):
                var part = AttributedString(run.text)
                if !intent.isEmpty { part.inlinePresentationIntent = intent }
                result += part
            case .bold(let run):
                result += attributed(run.children, intent: intent.union(.stronglyEmphasized))
            case .italic(let run):
                result += attributed(run.children, intent: intent.union(.emphasized))
            case .break:
                result += AttributedString("\n")
            }
        }
        return result
    }
}
