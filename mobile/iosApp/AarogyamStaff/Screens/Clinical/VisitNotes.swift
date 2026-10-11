import AarogyamShared
import SakalyaUI
import SwiftUI

/// The quick note: bullets with a kind each (retag or remove), a field to add one, dictation,
/// the autosave state, and Rx / Sign / Close.
struct VisitNotesPanel: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute
    let holder: VisitStateHolder
    let view: VisitView_
    let patient: Patient360State
    @State private var kind: BulletKind = .complaint
    @State private var draft = ""
    @State private var language: DictationLanguage = .english
    @State private var writingRx = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.ml) {
            HStack {
                V7Label(text: CL("c.visit.note"))
                Spacer(minLength: 0)
                SaveBadge(save: view.save)
            }
            if view.bullets.isEmpty && view.liveText == nil {
                Text("c.visit.note.empty", tableName: "ClinicalV7").font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color)
            }
            VStack(spacing: 3) {
                let bullets = view.bullets
                ForEach(Array(bullets.enumerated()), id: \.element.id) { index, bullet in
                    BulletRow(holder: holder, bullet: bullet, locked: view.save == .signed)
                        .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: bullets.count), style: .continuous))
                }
            }
            if let live = view.liveText { LiveCard(text: live) }
            if view.save != .signed { addRow; dictation }
            if let error = view.error?.message {
                Text(error).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color)
            }
            actions
        }
        .sheet(isPresented: $writingRx) {
            RxSheet(graph: graph, clinic: clinic, patientId: route.patientId, allergies: allergies, phone: phone, visitId: view.visitId)
        }
    }

    private var addRow: some View {
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            HStack(spacing: SkSpacing.sm) {
                ForEach(BulletKind.userKinds, id: \.self) { option in
                    SkChoiceChip(option.label, selected: kind == option) { kind = option }
                }
            }
            HStack(spacing: SkSpacing.sm) {
                TextField(CL("c.visit.add.prompt"), text: $draft, axis: .vertical)
                    .font(.system(size: 15)).lineLimit(1...4)
                    .padding(.horizontal, 14).frame(minHeight: 46)
                    .background(theme.roles.surface3.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .submitLabel(.done)
                SkPillButton(CL("c.visit.add"), variant: .tonal) { add() }
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private var dictation: some View {
        let listening = view.listening != nil
        return VStack(alignment: .leading, spacing: SkSpacing.sm) {
            HStack(spacing: SkSpacing.sm) {
                ForEach(DictationLanguage.allCases, id: \.self) { option in
                    SkChoiceChip(option.chipLabel, selected: (view.listening ?? language) == option) { if !listening { language = option } }
                }
            }
            .opacity(listening ? 0.6 : 1)
            Button { listening ? holder.stopListening() : holder.listen(language: language) } label: {
                Label(listening ? CL("c.visit.dictate.stop") : CL("c.visit.dictate"), systemImage: listening ? "stop.circle.fill" : "mic.fill")
                    .font(.system(size: 15, weight: .bold))
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .foregroundStyle(listening ? theme.roles.onErrorContainer.color : theme.roles.onPrimaryContainer.color)
                    .background((listening ? theme.roles.errorContainer : theme.roles.primaryContainer).color, in: Capsule())
            }
            .buttonStyle(.skPressable)
            Text("c.visit.dictate.note", tableName: "ClinicalV7").font(.system(size: 11.5)).foregroundStyle(theme.roles.onSurfaceVariant.color)
        }
    }

    private var actions: some View {
        let signed = view.save == .signed
        return VStack(spacing: SkSpacing.sm) {
            SkPillButton(CL("c.visit.rx"), variant: .tonal, wide: true) { writingRx = true }
                .disabled(!clinic.permissions.contains("prescriptions.issue"))
            HStack(spacing: SkSpacing.sm) {
                SkPillButton(signed ? CL("c.visit.signed") : CL("c.visit.sign"), variant: .fill, wide: true, loading: view.save == .saving) { holder.sign() }
                    .disabled(view.bullets.isEmpty || signed)
                SkPillButton(CL("c.visit.close"), variant: .warm, wide: true, loading: view.closing) { holder.close() }
            }
        }
    }

    private func add() {
        holder.addBullet(kind: kind, text: draft)
        draft = ""
    }

    private var person: PatientView? {
        if case .loaded(let loaded) = onEnum(of: patient) { loaded.view } else { nil }
    }

    private var allergies: [AllergyView] { person?.flags.allergies ?? [] }
    private var phone: String? { person?.phone }
}

/// One bullet: its kind (a menu to retag), editable text, remove.
private struct BulletRow: View {
    let holder: VisitStateHolder
    let bullet: Bullet
    let locked: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: SkSpacing.m) {
            Menu {
                ForEach(BulletKind.allCases, id: \.self) { option in
                    Button(option.label) { holder.retag(id: bullet.id, kind: option) }
                }
            } label: {
                SkChip(bullet.kind.label, tone: bullet.kind.tone).frame(minHeight: 32)
            }
            .disabled(locked)
            .accessibilityLabel(CLf("c.visit.retag.a11y", bullet.kind.label))
            TextField("", text: Binding(get: { bullet.text }, set: { holder.editBullet(id: bullet.id, text: $0) }), axis: .vertical)
                .font(.system(size: 14.5)).foregroundStyle(theme.roles.onSurface.color)
                .disabled(locked).frame(minHeight: 32)
            if !locked {
                Button { holder.removeBullet(id: bullet.id) } label: {
                    V7Icon(name: "plus", size: 18, tint: theme.roles.onSurfaceVariant.color).rotationEffect(.degrees(45))
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel(CL("c.visit.remove"))
            }
        }
        .padding(.vertical, 8).padding(.horizontal, 11)
    }
}

/// What the recogniser is hearing right now.
private struct LiveCard: View {
    let text: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: SkSpacing.m) {
            SkLiveDot().padding(.top, 5)
            Text(text).font(.system(size: 14.5)).italic().foregroundStyle(theme.roles.onSurface.color)
            Spacer(minLength: 0)
        }
        .padding(SkSpacing.ml)
        .background(theme.roles.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CLf("c.visit.hearing.a11y", text))
    }
}

/// Autosave state as a small chip.
private struct SaveBadge: View {
    let save: NoteSave

    var body: some View {
        SkChip(save.label, tone: save.tone)
    }
}

extension BulletKind {
    /// The kinds a person picks when typing; Dictated only comes from the microphone.
    static let userKinds: [BulletKind] = [.complaint, .finding, .advice]

    var label: String {
        switch self {
        case .complaint: CL("c.visit.kind.complaint")
        case .finding: CL("c.visit.kind.finding")
        case .advice: CL("c.visit.kind.advice")
        case .dictated: CL("c.visit.kind.dictated")
        }
    }

    var tone: SkTone {
        switch self {
        case .complaint: .warning
        case .finding: .info
        case .advice: .success
        case .dictated: .brand
        }
    }
}

extension NoteSave {
    var label: String {
        switch self {
        case .empty: CL("c.visit.save.empty")
        case .unsaved: CL("c.visit.save.unsaved")
        case .saving: CL("c.visit.save.saving")
        case .saved: CL("c.visit.save.saved")
        case .signed: CL("c.visit.save.signed")
        case .failed: CL("c.visit.save.failed")
        }
    }

    var tone: SkTone {
        switch self {
        case .empty: .neutral
        case .unsaved, .saving: .warning
        case .saved, .signed: .success
        case .failed: .danger
        }
    }
}

extension DictationLanguage {
    /// The chip text: each language in its own script.
    var chipLabel: String {
        switch self {
        case .english: "English"
        case .hindi: "हिन्दी"
        case .marathi: "मराठी"
        }
    }
}
