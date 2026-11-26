import AarogyamShared
import SakalyaUI
import SwiftUI

/// The tooth's past notes, newest first, each with who wrote it and when.
struct ToothNotesList: View {
    let sheet: ToothSheetStateHolder
    @State private var notes = ToothNotesState(items: [], error: nil)
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(notes.items, id: \.id) { note in
                VStack(alignment: .leading, spacing: 1) {
                    Text(note.body).v7Text(14).foregroundStyle(theme.roles.onSurface.color)
                    let who = [note.by, note.at.map { ClinicFormat.date(iso: $0.date.isoText) }].compactMap { $0 }.joined(separator: " · ")
                    if !who.isEmpty { V7Muted(who) }
                }
                .accessibilityElement(children: .combine)
            }
            if let error = notes.error {
                Text(pv("pv.tooth.health_failed") + " " + error.message).v7Text(12.5, .semibold).foregroundStyle(theme.roles.error.color)
            }
        }
        .task { for await next in sheet.toothNotes { notes = next } }
    }
}
