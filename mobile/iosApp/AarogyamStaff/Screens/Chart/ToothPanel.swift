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

/// Records one finding on `tooth`; whole-tooth findings lock the surface to the whole tooth.
struct RecordFindingSheet: View {
    let tooth: ToothView
    let onSave: (Finding, Surface?, String?) -> Void
    @State private var finding: Finding = .caries
    @State private var surface: Surface?
    @State private var note = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    init(tooth: ToothView, initialSurface: Surface?, onSave: @escaping (Finding, Surface?, String?) -> Void) {
        self.tooth = tooth
        self.onSave = onSave
        _surface = State(initialValue: initialSurface)
    }

    var body: some View {
        let chosen = finding.wholeTooth ? nil : surface
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: SkSpacing.sm) {
                    Text(chartText("chart.finding")).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: SkSpacing.s)], spacing: SkSpacing.s) {
                        ForEach(Finding.allCases, id: \.self) { f in Pill(text: f.label, selected: f == finding) { finding = f } }
                    }
                    Text(chartText("chart.surface")).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
                        .padding(.top, SkSpacing.sm)
                    SurfacePicker(tooth: tooth, selection: chosen, enabled: !finding.wholeTooth) { surface = $0 }
                    SkTextField(chartText("chart.note"), text: $note)
                        .padding(.top, SkSpacing.sm)
                        .onChange(of: note) { _, new in if new.count > 500 { note = String(new.prefix(500)) } }
                    SkButton(chartText("chart.save")) { onSave(finding, chosen, note) }
                        .padding(.top, SkSpacing.l)
                }
                .padding(SkSpacing.xl)
            }
            .navigationTitle(String(format: chartText("chart.record_title"), Int(tooth.number)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(chartText("chart.cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
