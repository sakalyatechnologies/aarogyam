import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Notes tab of Patient 360: the patient's summary note (editable with `clinical.write`), then the visit notes.
struct NotesTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String

    var body: some View {
        ScreenHost(make: { graph.patientNotes(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            NotesList(holder: holder, state: state)
        }
    }
}

private struct NotesList: View {
    let holder: PatientNotesStateHolder
    let state: PatientNotesState
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) { content }
                .padding(.horizontal, SkSpacing.l)
                .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { await refresh() }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "patient.tab.notes"), message: String(localized: "notes.not_allowed"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "patient.tab.notes"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            if let error = loaded.error {
                Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
            }
            SummaryCard(holder: holder, loaded: loaded)
            Text(String(localized: "notes.visits.title")).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
            if loaded.visitNotes.isEmpty {
                muted(String(localized: "notes.visits.none"))
            }
            ForEach(loaded.visitNotes, id: \.id) { visitNote($0) }
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
    }

    private func visitNote(_ note: VisitNoteView) -> some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack {
                    Text(note.titleText).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                    Spacer()
                    SkChip(note.status.label, tone: note.status.tone)
                }
                muted(note.byLine)
                ForEach(note.sections, id: \.section) { section in
                    VStack(alignment: .leading, spacing: SkSpacing.xxs) {
                        muted(section.section.label)
                        RichTextView(text: section.text)
                    }
                }
                if note.addendaCount > 0 { muted(note.addendaText) }
            }
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? PatientNotesStateLoaded, now.refreshing { continue }
            break
        }
    }
}
