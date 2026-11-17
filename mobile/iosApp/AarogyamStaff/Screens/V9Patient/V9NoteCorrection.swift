import AarogyamShared
import SakalyaUI
import SwiftUI

extension CorrectableNote: @retroactive Identifiable {}

/// A corrected note's id, for the earlier-versions sheet.
struct NoteVersionsRef: Identifiable { let id: String }

private let noteSections: [(NoteSection, String.LocalizationValue)] = [
    (.subjective, "p9.note.s"), (.objective, "p9.note.o"), (.assessment, "p9.note.a"), (.plan, "p9.note.p"),
]

/// "Correct note": the note's four parts to edit, then Sign correction. `onDone` gets whether it was saved.
struct V9NoteCorrectionSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let note: CorrectableNote
    let onDone: (Bool) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScreenHost(make: { graph.noteCorrection(clinic: clinic, note: note, screen: $0) }, state: { $0.state }) { holder, state in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SkSheetHeader(p9("p9.note.correct"), subtitle: note.author)
                    V7Muted(p9("p9.note.correct.hint"))
                    ForEach(noteSections, id: \.0) { section, label in
                        field(p9(label), text: Binding(get: { state.text(section: section) }, set: { holder.set(section: section, text: $0) }))
                    }
                    if state.stale {
                        Text(p9("p9.note.correct.stale")).v7Text(12.5).foregroundStyle(theme.roles.error.color)
                    }
                    if let error = state.error { V9ErrorLine(error: error) }
                    SkPillButton(p9("p9.note.correct.save"), wide: true, loading: state.saving) { holder.save() }
                        .disabled(!state.canSave)
                }
                .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
            }
            .skSheet()
            .onChange(of: state.saved) { _, saved in if saved { onDone(true) } }
        }
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: SkSpacing.xs) {
            Text(label).v7Text(12.5, .bold).foregroundStyle(r.onSurfaceVariant.color)
            TextField(label, text: text, axis: .vertical)
                .v7Text(15).foregroundStyle(r.onSurface.color)
                .lineLimit(2...8)
                .padding(.horizontal, SkSpacing.ml).padding(.vertical, 10)
                .frame(minHeight: SkSpacing.minTouchTarget)
                .background(r.card.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}

/// The versions a correction replaced, newest first.
struct V9NoteVersionsSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let noteId: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScreenHost(make: { graph.noteVersions(clinic: clinic, noteId: noteId, screen: $0) }, state: { $0.state }) { holder, state in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SkSheetHeader(p9("p9.note.versions.title"))
                    switch onEnum(of: state) {
                    case .loading: SkLoadingIndicator(pv("pv.loading"))
                    case .failed(let failed):
                        V9ErrorLine(error: failed.error)
                        SkPillButton(String(localized: "try_again"), variant: .tonal, wide: true) { holder.refresh() }
                    case .loaded(let loaded):
                        if loaded.versions.isEmpty { V7Muted(p9("p9.note.versions.none")) }
                        ForEach(Array(loaded.versions.enumerated()), id: \.offset) { _, version in versionCard(version) }
                    }
                }
                .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
            }
            .skSheet()
        }
    }

    private func versionCard(_ v: NoteVersion) -> some View {
        let r = theme.roles
        let at = v.at.map { ClinicFormat.date(iso: $0.date.isoText) + " · " + ClinicFormat.time(minuteOfDay: $0.time.minuteOfDay) }
        let parts: [(String.LocalizationValue, String?)] = [
            ("p9.note.s", v.subjective), ("p9.note.o", v.objective), ("p9.note.a", v.assessment), ("p9.note.p", v.plan),
        ]
        return V7Card {
            VStack(alignment: .leading, spacing: 6) {
                Text([v.author, at].compactMap { $0 }.joined(separator: " · ")).v7Text(12.5, .bold).foregroundStyle(r.onSurfaceVariant.color)
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    if let text = part.1 {
                        Text(p9(part.0)).v7Text(11, .heavy).foregroundStyle(r.onPrimaryContainer.color)
                        Text(text).v7Text(14).foregroundStyle(r.onSurface.color)
                    }
                }
            }
        }
    }
}
