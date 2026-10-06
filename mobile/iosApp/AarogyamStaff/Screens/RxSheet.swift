import AarogyamShared
import SakalyaUI
import SwiftUI

/// Writes and issues a prescription; once issued the same sheet turns into the share sheet.
struct RxSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let allergies: [AllergyView]

    var body: some View {
        ScreenHost(make: { graph.rxSheet(clinic: clinic, patientId: patientId, allergies: allergies, screen: $0) }, state: { $0.state }) { holder, state in
            RxSheetContent(holder: holder, state: state)
                // The issued sheet (PIN and share) is short; composing needs the room.
                .presentationDetents(state.phase == .issued ? [.medium] : [.large])
        }
    }
}

private struct RxSheetContent: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                Text(state.phase == .issued ? String(localized: "rx.issued.title") : String(localized: "rx.sheet.title"))
                    .skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                    .accessibilityAddTraits(.isHeader)
                if let number = state.issued?.number { muted(number) }
                if !state.allowed {
                    muted(String(localized: "rx.sheet.not_allowed"))
                } else if state.phase == .issued {
                    RxSharePanel(holder: holder, state: state) { dismiss() }
                } else {
                    RxComposer(holder: holder, state: state)
                }
            }
            .padding(SkSpacing.l)
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
    }
}

private struct RxComposer: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    @Environment(\.skTheme) private var theme

    var body: some View {
        let locked = state.phase == .issuing
        SkSearchField(
            text: Binding(get: { state.query }, set: { holder.search(query: $0) }),
            prompt: String(localized: "rx.search")
        )
        ForEach(state.results, id: \.id) { drug in
            Button { holder.add(drug: drug) } label: {
                SkListRow(drug.name, subtitle: drug.subtitleText)
            }
            .buttonStyle(.plain)
        }
        if state.lines.isEmpty && state.results.isEmpty {
            SkButton(String(localized: "rx.quick"), variant: .secondary) { holder.quickRx() }
        }
        ForEach(state.lines, id: \.key) { line in
            RxLineCard(holder: holder, line: line, editable: !locked)
        }
        if state.needsOverride { warnings }
        if let error = state.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
        }
        SkButton(locked ? String(localized: "rx.issuing") : String(localized: "rx.issue")) { holder.issue() }
            .disabled(!state.canIssue)
    }

    private var warnings: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                ForEach(Array(state.warnings.enumerated()), id: \.offset) { _, warning in
                    danger(warning.text)
                }
                ForEach(Array(state.serverAlerts.enumerated()), id: \.offset) { _, alert in
                    danger(alert.message)
                }
                if state.serverAlert, state.serverAlerts.isEmpty { danger(String(localized: "rx.server_alert")) }
                SkTextField(
                    String(localized: "rx.override.label"),
                    text: Binding(get: { state.overrideReason }, set: { holder.setOverrideReason(text: $0) }),
                    message: String(localized: "rx.override.help")
                )
            }
        }
    }

    private func danger(_ text: String) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
    }
}

private struct RxLineCard: View {
    let holder: RxSheetStateHolder
    let line: RxLine
    let editable: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack {
                    VStack(alignment: .leading, spacing: SkSpacing.xxs) {
                        Text(line.name).skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                        if !line.detail.isEmpty {
                            Text(line.detail).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                        }
                    }
                    Spacer()
                    if editable {
                        Button(String(localized: "rx.remove"), role: .destructive) { holder.remove(key: line.key) }
                            .accessibilityLabel(String(format: String(localized: "rx.remove.named"), line.name))
                            .frame(minHeight: 44)
                    }
                }
                presets("rx.dose", RxPresets.shared.doses, selected: line.dose, text: { $0 }) { holder.setDose(key: line.key, dose: $0) }
                presets("rx.frequency", RxPresets.shared.frequencies, selected: line.frequency, text: { $0 }) {
                    holder.setFrequency(key: line.key, frequency: $0)
                }
                presets("rx.duration", RxPresets.shared.durations.map(\.intValue), selected: Int(line.durationDays), text: { RxFormat.days($0) }) {
                    holder.setDuration(key: line.key, days: Int32($0))
                }
            }
        }
    }

    private func presets<T: Hashable>(
        _ label: String.LocalizationValue,
        _ options: [T],
        selected: T,
        text: @escaping (T) -> String,
        pick: @escaping (T) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: SkSpacing.xs) {
            Text(String(localized: label)).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: SkSpacing.s) {
                    ForEach(options.contains(selected) ? options : [selected] + options, id: \.self) { option in
                        Button { pick(option) } label: {
                            SkChip(text(option), tone: option == selected ? .brand : .neutral).frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .disabled(!editable)
                        .accessibilityAddTraits(option == selected ? .isSelected : [])
                    }
                }
            }
        }
    }
}

private struct RxSharePanel: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        switch onEnum(of: state.share ?? ShareStateCreating.shared) {
        case .creating:
            Text(String(localized: "rx.link.creating")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.l)
        case .failed(let failed):
            Text(failed.error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
            SkButton(String(localized: "rx.share.retry")) { holder.share() }
        case .ready(let ready):
            let link = ready.link
            Text(String(localized: "rx.pin.label")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            Text(link.pin).skTextStyle(SkTypeScale.largeTitle).foregroundStyle(p.text.color).monospacedDigit()
            Text(String(localized: "rx.pin.note")).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            if let expires = link.expiresAt {
                Text(String(format: String(localized: "rx.link.expires"), ClinicFormat.date(iso: expires.date.isoText)))
                    .skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
            }
            if let url = URL(string: link.url) {
                ShareLink(
                    item: url,
                    subject: Text(String(localized: "rx.share.chooser")),
                    message: Text(link.shareMessage(clinic: state.issued?.clinicName ?? ""))
                ) {
                    Label(String(localized: "rx.share"), systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        SkButton(String(localized: "done"), variant: .secondary, action: onDone)
    }
}
