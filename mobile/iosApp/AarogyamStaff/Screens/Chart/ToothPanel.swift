import AarogyamShared
import SakalyaUI
import SwiftUI

/// The picked tooth: what is on it now, a surface picker, the record action and its history.
struct ToothPanel: View {
    let selection: ToothSelection
    let canRecord: Bool
    let saving: Bool
    let onSurface: (Surface?) -> Void
    let onRecord: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let tooth = selection.tooth
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text("\(String(format: chartText("chart.tooth"), Int(tooth.number))) · \(tooth.kind.label)")
                    .skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                caption("chart.surface")
                SurfacePicker(tooth: tooth, selection: selection.surface, enabled: true, onPick: onSurface)
                caption("chart.now")
                let findings = tooth.findings.isEmpty ? [SurfaceFinding(surface: nil, finding: .sound)] : tooth.findings
                ForEach(Array(findings.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: SkSpacing.s) {
                        FindingSwatch(finding: item.finding)
                        Text("\(item.finding.label), \(tooth.surfaceText(item.surface))")
                            .skTextStyle(SkTypeScale.footnote).foregroundStyle(p.text.color)
                    }
                }
                if canRecord {
                    SkButton(chartText(saving ? "chart.saving" : "chart.record"), action: onRecord)
                        .disabled(saving)
                        .padding(.top, SkSpacing.sm)
                }
                caption("chart.history")
                history(tooth)
            }
        }
    }

    private func caption(_ key: String.LocalizationValue) -> some View {
        Text(chartText(key)).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color).padding(.top, SkSpacing.sm)
    }

    @ViewBuilder private func history(_ tooth: ToothView) -> some View {
        let p = theme.palette
        switch onEnum(of: selection.history) {
        case .loading:
            ProgressView()
        case .failed:
            Text(chartText("chart.history_failed")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
        case .loaded(let loaded):
            if loaded.entries.isEmpty {
                Text(chartText("chart.history_none")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            }
            ForEach(loaded.entries, id: \.id) { entry in
                let current = entry.status == .current
                HStack(spacing: 0) {
                    Rectangle().fill(current ? p.brand.color : p.rule.color).frame(width: 3)
                    VStack(alignment: .leading, spacing: SkSpacing.xxs) {
                        Text("\(entry.finding.label), \(tooth.surfaceText(entry.surface))")
                            .skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(current ? p.text.color : p.textMuted.color)
                        if !entry.treatmentText.isEmpty {
                            Text(entry.treatmentText).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.text.color)
                        }
                        if !entry.detailText.isEmpty {
                            Text(entry.detailText).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                        }
                    }
                    .padding(.horizontal, SkSpacing.ml)
                    .padding(.vertical, SkSpacing.sm)
                    Spacer(minLength: 0)
                }
                .background(p.inset.color, in: UnevenRoundedRectangle(bottomTrailingRadius: SkSpacing.m, topTrailingRadius: SkSpacing.m))
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// Whole tooth plus the five surfaces, named for this tooth (incisal, palatal...).
struct SurfacePicker: View {
    let tooth: ToothView
    let selection: Surface?
    let enabled: Bool
    let onPick: (Surface?) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 88), spacing: SkSpacing.s)], alignment: .leading, spacing: SkSpacing.s) {
            Pill(text: tooth.surfaceText(nil), selected: selection == nil) { onPick(nil) }
            ForEach(Surface.allCases, id: \.self) { surface in
                Pill(text: tooth.surfaceText(surface), selected: selection == surface, enabled: enabled) { onPick(surface) }
            }
        }
    }
}

/// A selectable pill: brand-filled when chosen.
struct Pill: View {
    let text: String
    let selected: Bool
    var enabled = true
    let action: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        Button(action: action) {
            Text(text)
                .skTextStyle(SkTypeScale.label)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .foregroundStyle(selected ? p.onPrimary.color : enabled ? p.text.color : p.textMuted.color)
                .frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget)
                .background(selected ? p.primary.color : p.inset.color, in: RoundedRectangle(cornerRadius: SkSpacing.ml))
                .overlay(RoundedRectangle(cornerRadius: SkSpacing.ml).strokeBorder(selected ? p.primary.color : p.rule.color))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The teeth picked with "Select several", and the action that records one finding on all of them.
struct GroupPanel: View {
    let group: [Int32]
    let canRecord: Bool
    let saving: Bool
    let onRecord: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(String(format: chartText("chart.group_title"), group.count))
                    .skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                Text(group.map(String.init).joined(separator: ", ")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.text.color)
                Text(chartText("chart.group_hint")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                if canRecord {
                    SkButton(saving ? chartText("chart.saving") : String(format: chartText("chart.record_group"), group.count), action: onRecord)
                        .disabled(saving)
                        .padding(.top, SkSpacing.sm)
                }
            }
        }
    }
}

/// What the record sheet needs to offer and add procedures and materials.
struct TermChoices {
    let terms: [TermView]
    let adding: Bool
    let added: TermView?
    let error: ScreenError?
    let onAdd: (TermKind, String) -> Void
    let onConsumed: () -> Void
}

/// Records one finding on `teeth`: the whole tooth or chosen surfaces (whole-tooth findings lock it to the whole tooth), with
/// a procedure and material picked by type-ahead or added for the clinic.
struct RecordFindingSheet: View {
    let teeth: [ToothView]
    let choices: TermChoices
    let onSave: (Finding, [Surface], TermView?, TermView?, String) -> Void
    @State private var finding: Finding = .caries
    @State private var surfaces: [Surface]
    @State private var procedure: TermView?
    @State private var material: TermView?
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    init(teeth: [ToothView], initialSurface: Surface?, choices: TermChoices, onSave: @escaping (Finding, [Surface], TermView?, TermView?, String) -> Void) {
        self.teeth = teeth
        self.choices = choices
        self.onSave = onSave
        _surfaces = State(initialValue: initialSurface.map { [$0] } ?? [])
    }

    var body: some View {
        let chosen = finding.wholeTooth ? [] : surfaces
        let one = teeth.count == 1 ? teeth.first : nil
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SkSpacing.sm) {
                    caption("chart.finding")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: SkSpacing.s)], spacing: SkSpacing.s) {
                        ForEach(Finding.allCases, id: \.self) { f in Pill(text: f.label, selected: f == finding) { finding = f } }
                    }
                    caption("chart.surfaces").padding(.top, SkSpacing.sm)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: SkSpacing.s)], alignment: .leading, spacing: SkSpacing.s) {
                        Pill(text: chartText("chart.whole_tooth"), selected: chosen.isEmpty) { surfaces = [] }
                        ForEach(Surface.allCases, id: \.self) { surface in
                            Pill(text: one?.surfaceText(surface) ?? surface.genericLabel, selected: chosen.contains(surface), enabled: !finding.wholeTooth) {
                                if let index = surfaces.firstIndex(of: surface) { surfaces.remove(at: index) } else { surfaces.append(surface) }
                            }
                        }
                    }
                    if finding != .sound {
                        caption("chart.procedure").padding(.top, SkSpacing.sm)
                        TermPicker(kind: .procedure, choices: choices, value: $procedure)
                        caption("chart.material").padding(.top, SkSpacing.sm)
                        TermPicker(kind: .material, choices: choices, value: $material)
                        if let error = choices.error {
                            Text(String(format: chartText("chart.term_failed"), error.message))
                                .skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
                        }
                    }
                    SkTextField(chartText("chart.note"), text: $note)
                        .padding(.top, SkSpacing.sm)
                        .onChange(of: note) { _, new in if new.count > 500 { note = String(new.prefix(500)) } }
                    SkButton(chartText("chart.save")) { onSave(finding, chosen, procedure, material, note) }
                        .disabled(choices.adding)
                        .padding(.top, SkSpacing.l)
                }
                .padding(SkSpacing.xl)
            }
            .navigationTitle(title(one))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(chartText("chart.cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .onChange(of: choices.added?.id) { _, id in
            guard id != nil, let added = choices.added else { return }
            if added.kind == .procedure { procedure = added } else { material = added }
            choices.onConsumed()
        }
    }

    private func title(_ one: ToothView?) -> String {
        if let one { return String(format: chartText("chart.record_title"), Int(one.number)) }
        return String(format: chartText("chart.record_title_group"), teeth.map { String($0.number) }.joined(separator: ", "))
    }

    private func caption(_ key: String.LocalizationValue) -> some View {
        Text(chartText(key)).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
    }
}

/// A procedure or material dropdown with type-ahead: the field filters the chart's list on the phone ("Z" offers Zirconia),
/// and "Add" saves a new term for the clinic. Mirrors Android's `TermPicker`.
struct TermPicker: View {
    let kind: TermKind
    let choices: TermChoices
    @Binding var value: TermView?
    @State private var text = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        let typed = text.trimmingCharacters(in: .whitespaces)
        let typing = !typed.isEmpty && typed != (value?.label ?? "")
        VStack(alignment: .leading, spacing: SkSpacing.xs) {
            SkTextField(
                chartText(kind == .material ? "chart.material" : "chart.procedure"),
                text: $text,
                prompt: chartText(kind == .material ? "chart.type_material" : "chart.type_procedure")
            )
            .onChange(of: text) { _, new in if new.trimmingCharacters(in: .whitespaces).isEmpty { value = nil } }
            .onChange(of: value?.id) { _, _ in text = value?.label ?? text }
            if typing {
                let matches = Array(ChartModelKt.matchTerms(terms: choices.terms, kind: kind, text: typed).prefix(6))
                ForEach(matches, id: \.id) { term in
                    Button {
                        value = term
                        text = term.label
                    } label: {
                        Text(term.own ? String(format: chartText("chart.term_own"), term.label) : term.label)
                            .skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color)
                            .frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
                if !ChartModelKt.hasLabel(terms: choices.terms, kind: kind, text: typed) {
                    Button {
                        choices.onAdd(kind, typed)
                    } label: {
                        Text(String(format: chartText("chart.term_add"), typed))
                            .skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(p.primary.color)
                            .frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .disabled(choices.adding)
                } else if matches.isEmpty {
                    Text(chartText("chart.term_none")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                }
            }
        }
    }
}
