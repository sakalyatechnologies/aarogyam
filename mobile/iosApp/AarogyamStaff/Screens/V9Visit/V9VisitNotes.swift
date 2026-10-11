import AarogyamShared
import SakalyaUI
import SwiftUI

/// Notes: dictate (with the voice capsule and language chips) or write, then bullets whose tag
/// is tapped to change section. Autosave is the state holder's; its state shows as a chip.
struct V9Notes: View {
    let holder: VisitStateHolder
    let view: VisitView_
    @State private var writing = false
    @State private var language: DictationLanguage = .english
    @State private var draft = ""
    @FocusState private var focused: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let locked = view.save == .signed
        let listening = view.listening != nil
        V7Card {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                HStack(alignment: .firstTextBaseline) {
                    Text("v9v.notes.title", tableName: "VisitV9").v7Text(16, .heavy).foregroundStyle(r.onSurface.color)
                    Spacer(minLength: 8)
                    SkChip(view.save.label, tone: view.save.tone)
                }
                if !locked {
                    HStack(spacing: SkSpacing.sm) {
                        VoiceCapsule(listening: listening) { listening ? holder.stopListening() : holder.listen(language: language) }
                        writeToggle
                    }
                    HStack(spacing: SkSpacing.sm) {
                        ForEach(DictationLanguage.allCases, id: \.self) { option in
                            SkChoiceChip(option.chipLabel, selected: (view.listening ?? language) == option) { if !listening { language = option } }
                        }
                    }
                    .opacity(listening ? 0.6 : 1)
                    if listening { listeningRow }
                    if writing { writeRow }
                }
                if view.bullets.isEmpty && !listening {
                    Text("v9v.notes.empty", tableName: "VisitV9").v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
                }
                ForEach(view.bullets, id: \.id) { bullet in
                    V9BulletRow(holder: holder, bullet: bullet, locked: locked)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .animation(.smooth(duration: 0.3), value: view.bullets.map(\.id))
            .animation(.smooth(duration: 0.25), value: writing)
        }
    }

    private var writeToggle: some View {
        let r = theme.roles
        return Button { writing.toggle(); if writing { focused = true } } label: {
            HStack(spacing: 6) {
                Image(systemName: "pencil")
                Text("v9v.notes.write", tableName: "VisitV9").v7Text(15, .bold)
            }
            .foregroundStyle((writing ? r.background : r.onSurface).color)
            .padding(.horizontal, 16).frame(minHeight: 52)
            .background((writing ? r.onSurface : r.surface3).color, in: Capsule())
        }
        .buttonStyle(.skPressable)
        .accessibilityAddTraits(writing ? .isSelected : [])
    }

    private var listeningRow: some View {
        let r = theme.roles
        return HStack(alignment: .center, spacing: SkSpacing.m) {
            VoiceWave()
            Text(view.liveText ?? V9("v9v.notes.listening")).v7Text(14.5).italic().foregroundStyle(r.onSurface.color)
            Spacer(minLength: 0)
        }
        .padding(SkSpacing.ml).frame(minHeight: 46)
        .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(view.liveText.map { CLf("c.visit.hearing.a11y", $0) } ?? V9("v9v.notes.listening"))
    }

    private var writeRow: some View {
        HStack(spacing: SkSpacing.sm) {
            TextField(V9("v9v.notes.prompt"), text: $draft)
                .v7Text(15).focused($focused).submitLabel(.return).onSubmit(add)
                .padding(.horizontal, 14).frame(minHeight: 48)
                .background(theme.roles.surface3.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            SkPillButton(V9("v9v.notes.add"), variant: .fill) { add() }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    /// Return adds the line as a bullet and keeps the keyboard up for the next one.
    private func add() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        holder.addBullet(kind: NoteTag.kindForNew(after: view.bullets), text: text)
        draft = ""
        focused = true
    }
}

/// One bullet: its tag (tap to cycle Complaint, Finding, Advice), the text and a remove button.
private struct V9BulletRow: View {
    let holder: VisitStateHolder
    let bullet: Bullet
    let locked: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(alignment: .top, spacing: SkSpacing.m) {
            Button { holder.retag(id: bullet.id, kind: NoteTag.next(bullet.kind)) } label: {
                Text(bullet.kind.label).v7Text(11, .heavy)
                    .foregroundStyle(ink).lineLimit(1)
                    .frame(minWidth: 76).padding(.horizontal, 8).padding(.vertical, 5)
                    .background(fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .frame(minHeight: 44, alignment: .top)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.skPressable)
            .disabled(locked)
            .accessibilityLabel(CLf("c.visit.retag.a11y", bullet.kind.label))
            TextField("", text: Binding(get: { bullet.text }, set: { holder.editBullet(id: bullet.id, text: $0) }), axis: .vertical)
                .v7Text(14.5).foregroundStyle(r.onSurface.color)
                .disabled(locked).frame(minHeight: 44, alignment: .top)
            if !locked {
                Button { holder.removeBullet(id: bullet.id) } label: {
                    V7Icon(name: "plus", size: 18, tint: r.onSurfaceVariant.color).rotationEffect(.degrees(45)).frame(width: 44, height: 44)
                }
                .accessibilityLabel(CL("c.visit.remove"))
            }
        }
    }

    private var fill: Color {
        let r = theme.roles
        switch NoteTag.letter(bullet.kind) {
        case "O": return r.primaryContainer.color
        case "P": return r.surface3.color
        default: return r.tertiaryContainer.color
        }
    }

    private var ink: Color {
        let r = theme.roles
        switch NoteTag.letter(bullet.kind) {
        case "O": return r.onPrimaryContainer.color
        case "P": return r.onSurface.color
        default: return r.onTertiaryContainer.color
        }
    }
}

/// Founder concept C4: an emerald mic pill. While listening a ripple spreads from the mic; with
/// Reduce Motion it is a still ring instead.
struct VoiceCapsule: View {
    let listening: Bool
    let action: () -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let r = theme.roles
        Button(action: action) {
            HStack(spacing: SkSpacing.m) {
                ZStack {
                    if listening { ripple }
                    Image(systemName: listening ? "stop.fill" : "mic.fill").font(.system(size: 17, weight: .bold))
                }
                .frame(width: 34, height: 34)
                Text(listening ? V9("v9v.notes.stop") : V9("v9v.notes.dictate")).v7Text(15, .bold).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .foregroundStyle(r.onPrimary.color)
            .padding(.horizontal, 14).frame(maxWidth: .infinity, minHeight: 52)
            .background(r.primary.color, in: Capsule())
        }
        .buttonStyle(.skPressable)
        .accessibilityLabel(listening ? V9("v9v.notes.stop.a11y") : V9("v9v.notes.dictate.a11y"))
        .accessibilityAddTraits(listening ? .isSelected : [])
    }

    @ViewBuilder private var ripple: some View {
        let ink = theme.roles.onPrimary.color
        if reduceMotion {
            Circle().stroke(ink.opacity(0.5), lineWidth: 2).frame(width: 34, height: 34)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                ZStack {
                    ForEach(0..<3, id: \.self) { index in
                        let phase = (t / 1.8 + Double(index) / 3).truncatingRemainder(dividingBy: 1)
                        Circle().stroke(ink.opacity(0.55 * (1 - phase)), lineWidth: 2)
                            .scaleEffect(0.7 + phase * 1.1)
                    }
                }
                .frame(width: 34, height: 34)
            }
            .accessibilityHidden(true)
        }
    }
}

/// Five bars that rise and fall while the recogniser listens; still bars with Reduce Motion.
struct VoiceWave: View {
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 20, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<5, id: \.self) { index in
                    let level = reduceMotion ? 0.5 : (sin(t * 6 + Double(index) * 0.9) + 1) / 2
                    Capsule().fill(theme.roles.onTertiaryContainer.color)
                        .frame(width: 4, height: 6 + 16 * level)
                }
            }
            .frame(height: 22)
        }
        .accessibilityHidden(true)
    }
}
