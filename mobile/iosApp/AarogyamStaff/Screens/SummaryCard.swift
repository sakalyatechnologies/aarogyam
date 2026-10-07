import AarogyamShared
import SakalyaUI
import SwiftUI

/// The summary note: read as formatted text, or edited with a small toolbar over the text box.
struct SummaryCard: View {
    let holder: PatientNotesStateHolder
    let loaded: PatientNotesStateLoaded
    @Environment(\.skTheme) private var theme
    @State private var controller = EditorController()

    private static let formats: [Format] = [.heading, .bold, .italic, .bullets, .numbers]

    var body: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(String(localized: "notes.summary.title")).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                if let editor = loaded.editor { form(editor) } else { reading }
            }
        }
    }

    @ViewBuilder private var reading: some View {
        if let summary = loaded.summary, !summary.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            RichTextView(text: summary.body)
            if let updated = updatedText(summary) { muted(updated) }
        } else {
            muted(String(localized: "notes.summary.empty"))
        }
        if loaded.canEdit {
            SkButton(
                loaded.summary == nil ? String(localized: "notes.write") : String(localized: "notes.edit"),
                variant: .secondary,
                action: holder.startEditing
            )
        }
    }

    private func form(_ editor: SummaryEditor) -> some View {
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            HStack {
                ForEach(Self.formats, id: \.self) { format in
                    Button(format.symbol) { controller.apply(format) }
                        .buttonStyle(.bordered)
                        .accessibilityLabel(format.label)
                }
            }
            FormattedTextEditor(text: editor.text, controller: controller, enabled: !editor.saving, onChange: holder.edit)
                .frame(minHeight: 160)
            if let problem = editor.problem?.text ?? editor.formatProblem?.message {
                Text(problem).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
            }
            if !editor.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, editor.formatProblem == nil {
                muted(String(localized: "notes.preview"))
                RichTextView(text: editor.text)
            }
            HStack(spacing: SkSpacing.sm) {
                SkButton(String(localized: "notes.cancel"), variant: .secondary, action: holder.cancelEditing)
                SkButton(String(localized: "notes.save"), action: holder.save).disabled(!editor.canSave)
            }
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
    }

    private func updatedText(_ summary: SummaryView) -> String? {
        guard let at = summary.updatedAt else { return nil }
        let when = ClinicFormat.date(iso: at.date.isoText)
        if let by = summary.updatedBy { return String(format: String(localized: "notes.updated_by"), when, by) }
        return String(format: String(localized: "notes.updated"), when)
    }
}
