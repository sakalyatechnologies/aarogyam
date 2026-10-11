import AarogyamShared
import SakalyaUI
import SwiftUI

/// Write prescription, inline: a card that grows in place (no sheet) with drug search, one card
/// per medicine, the allergy check, Save draft and Sign and issue; once signed it shows the
/// delivery choices. The state holder is the Rx sheet's, made for this visit, so the issued
/// prescription carries the visit's encounter id.
struct V9RxCard: View {
    let rx: RxSheetStateHolder
    let state: RxSheetState
    let phone: String?
    let canIssue: Bool
    @Binding var open: Bool
    @Binding var draftKept: Bool
    @State private var typed = ""
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var signed: Bool { state.phase == .issued }

    var body: some View {
        let r = theme.roles
        VStack(spacing: 0) {
            header
            if open {
                VStack(alignment: .leading, spacing: SkSpacing.m) { content }
                    .padding(.horizontal, 14).padding(.bottom, 14)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay { if open { RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(r.primary.color, lineWidth: 2) } }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .animation(reduceMotion ? nil : .smooth(duration: 0.4), value: open)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: state.lines.map(\.key))
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: signed)
    }

    private var header: some View {
        let r = theme.roles
        return Button { open.toggle() } label: {
            HStack(spacing: SkSpacing.ml) {
                ZStack {
                    Circle().fill(r.primaryContainer.color)
                    V7Icon(name: "rx", size: 20, tint: r.onPrimaryContainer.color)
                }
                .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(signed ? V9("v9v.rx.title.signed") : V9("v9v.rx.title")).v7Text(15, .heavy).foregroundStyle(r.onSurface.color)
                    Text(subtitle).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                ZStack {
                    Circle().fill(r.surface2.color)
                    V7Icon(name: "plus", size: 18, tint: r.onSurface.color).rotationEffect(.degrees(open ? 45 : 0))
                }
                .frame(width: 36, height: 36)
            }
            .padding(14).frame(minHeight: 72)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(signed ? V9("v9v.rx.title.signed") : V9("v9v.rx.title"))
        .accessibilityValue(subtitle)
        .accessibilityHint(open ? V9("v9v.rx.collapse.a11y") : V9("v9v.rx.expand.a11y"))
        .accessibilityAddTraits(.isButton)
    }

    private var subtitle: String {
        if !canIssue || !state.allowed { return V9("v9v.rx.not_allowed.short") }
        if signed { return state.issued?.number.map { V9f("v9v.rx.signed.sub", $0) } ?? V9("v9v.rx.signed.plain") }
        if state.lines.isEmpty { return V9("v9v.rx.hint") }
        return V9f("v9v.rx.sub.count", state.lines.count, state.draft == .saved ? V9("v9v.rx.draft.kept") : V9("v9v.rx.draft"))
    }

    @ViewBuilder private var content: some View {
        if !canIssue || !state.allowed {
            Text("v9v.rx.not_allowed", tableName: "VisitV9").v7Text(13.5).foregroundStyle(theme.roles.onSurfaceVariant.color)
        } else if signed {
            signedContent
        } else {
            composer
        }
    }

    // MARK: Composer

    @ViewBuilder private var composer: some View {
        let r = theme.roles
        let locked = state.phase == .issuing
        SkSearchField(text: Binding(get: { typed }, set: { typed = $0; rx.search(query: $0) }), prompt: V9("v9v.rx.search"))
            .disabled(locked)
        if state.searching {
            SkLoadingIndicator(V9("v9v.rx.searching"))
        } else if !state.results.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: SkSpacing.sm) {
                    ForEach(state.results, id: \.id) { drug in
                        Button { rx.add(drug: drug); typed = "" } label: { suggestion(drug) }
                            .buttonStyle(.skPressable)
                    }
                }
                .padding(.horizontal, 14)
            }
            .padding(.horizontal, -14)
        } else if !typed.trimmingCharacters(in: .whitespaces).isEmpty {
            Text("v9v.rx.no_match", tableName: "VisitV9").v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
        }
        if state.lines.isEmpty && state.results.isEmpty && typed.isEmpty {
            SkPillButton(String(localized: "rx.quick"), variant: .tonal, wide: true) { rx.quickRx() }
            Text("v9v.rx.how", tableName: "VisitV9").v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
        }
        ForEach(state.lines, id: \.key) { line in
            V9MedCard(rx: rx, line: line, warned: state.warnings.contains { $0.lineKey == line.key }, editable: !locked)
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
        }
        if state.needsOverride { V9AllergyCard(rx: rx, state: state) }
        if let error = state.error {
            Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
        }
        if !state.lines.isEmpty {
            HStack(spacing: SkSpacing.sm) {
                SkPillButton(state.draft == .saved ? V9("v9v.rx.draft.saved") : V9("v9v.rx.save_draft"), variant: .tonal, wide: true) {
                    rx.saveDraft()
                    draftKept = true
                    open = false
                }
                .disabled(locked)
                SkPillButton(locked ? String(localized: "rx.issuing") : V9("v9v.rx.sign"), variant: .fill, wide: true, loading: locked) { rx.issue() }
                    .disabled(!state.canIssue)
            }
        }
    }

    private func suggestion(_ drug: DrugView) -> some View {
        let r = theme.roles
        return HStack(spacing: 6) {
            V7Icon(name: "plus", size: 14, tint: r.onSurface.color)
            Text(drug.name).v7Text(13.5, .semibold)
            Text(drug.strength).v7Text(11.5).opacity(0.7)
        }
        .foregroundStyle(r.onSurface.color).lineLimit(1)
        .padding(.horizontal, 12).frame(minHeight: 44)
        .background(r.surface3.color, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(V9f("v9v.rx.add.a11y", drug.name))
    }

    // MARK: Signed

    @ViewBuilder private var signedContent: some View {
        let r = theme.roles
        ForEach(state.lines, id: \.key) { line in
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name).v7Text(14.5, .bold).foregroundStyle(r.onSurface.color)
                Text(V9Dose.totalText(frequency: line.frequency, days: Int(line.durationDays), detail: line.detail))
                    .v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .combine)
        }
        HStack(spacing: 8) {
            V7Icon(name: "check", size: 18, tint: r.primary.color)
            Text(state.issued?.number.map { V9f("v9v.rx.signed.by", $0) } ?? V9("v9v.rx.signed.plain")).v7Text(13, .bold).foregroundStyle(r.primary.color)
        }
        RxDelivery(holder: rx, state: state, phone: phone) { open = false }
    }
}

/// One medicine: its name, three dose cells that cycle on tap, timing, days and the total.
private struct V9MedCard: View {
    let rx: RxSheetStateHolder
    let line: RxLine
    let warned: Bool
    let editable: Bool
    @State private var timing: String?
    @Environment(\.skTheme) private var theme

    init(rx: RxSheetStateHolder, line: RxLine, warned: Bool, editable: Bool) {
        self.rx = rx
        self.line = line
        self.warned = warned
        self.editable = editable
        _timing = State(initialValue: line.timing)
    }

    private static let timings: [(key: String, label: String.LocalizationValue)] = [
        ("before_food", "v9v.timing.before_food"), ("after_food", "v9v.timing.after_food"),
        ("empty_stomach", "v9v.timing.empty_stomach"), ("bedtime", "v9v.timing.bedtime"), ("sos", "v9v.timing.sos"),
    ]

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(line.name).v7Text(14.5, .heavy).foregroundStyle(r.onSurface.color)
                    if !line.detail.isEmpty { Text(line.detail).v7Text(12).foregroundStyle(r.onSurfaceVariant.color) }
                }
                Spacer(minLength: 8)
                if editable {
                    Button { rx.remove(key: line.key) } label: {
                        V7Icon(name: "plus", size: 18, tint: r.onSurface.color).rotationEffect(.degrees(45))
                            .frame(width: 44, height: 44).background(r.surface3.color, in: Circle())
                    }
                    .accessibilityLabel(String(format: String(localized: "rx.remove.named"), line.name))
                }
            }
            HStack(spacing: 6) {
                ForEach(V9Dose.slots, id: \.self) { slot in cell(slot) }
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    V7Label(text: V9("v9v.timing.label"))
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SkSpacing.sm) {
                        ForEach(Self.timings, id: \.key) { option in
                            SkChoiceChip(V9(option.label), selected: timing == option.key) { if editable { pick(option.key) } }
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.horizontal, -12)
            }
            HStack(spacing: SkSpacing.sm) {
                stepper
                Spacer(minLength: 4)
                Text(V9Dose.totalText(frequency: line.frequency, days: Int(line.durationDays), detail: line.detail, sos: timing == "sos"))
                    .v7Text(13, .bold).foregroundStyle(r.primary.color).multilineTextAlignment(.trailing)
                    .accessibilityLabel(V9f("v9v.rx.total.a11y", V9Dose.totalText(frequency: line.frequency, days: Int(line.durationDays), detail: line.detail, sos: timing == "sos")))
            }
        }
        .padding(12)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay { if warned { RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(r.error.color, lineWidth: 2) } }
    }

    private func pick(_ key: String) {
        let next: String? = timing == key ? nil : key
        timing = next
        rx.setTiming(key: line.key, timing: next.flatMap { RxTiming.Companion.shared.fromApi(text: $0) })
    }

    private func slotName(_ slot: DoseSlot) -> String {
        switch slot {
        case .morning: V9("v9v.dose.morning")
        case .afternoon: V9("v9v.dose.afternoon")
        case .night: V9("v9v.dose.night")
        }
    }

    private func cell(_ slot: DoseSlot) -> some View {
        let r = theme.roles
        let halves = V9Dose.halves(line.frequency, slot: slot)
        let shown = V9Dose.cell(halves)
        return Button {
            if editable { rx.setFrequency(key: line.key, frequency: V9Dose.cycled(line.frequency, slot: slot)) }
        } label: {
            VStack(spacing: 2) {
                Text(slotName(slot)).v7Text(11, .bold).foregroundStyle(halves > 0 ? r.onPrimaryContainer.color : r.onSurfaceVariant.color).lineLimit(1).minimumScaleFactor(0.7)
                Text(shown).font(.system(size: 22, weight: .heavy, design: .monospaced)).contentTransition(.numericText())
            }
            .foregroundStyle(halves > 0 ? r.onPrimaryContainer.color : r.onSurface.color)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background((halves > 0 ? r.primaryContainer : r.surface3).color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .animation(.smooth(duration: 0.2), value: halves)
        .accessibilityLabel(V9f("v9v.dose.a11y", slotName(slot), shown))
    }

    private var stepper: some View {
        let r = theme.roles
        return HStack(spacing: 6) {
            stepButton("minus", label: V9("v9v.days.fewer"), step: -1)
            Text(RxFormat.days(Int(line.durationDays))).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                .frame(minWidth: 54).lineLimit(1).minimumScaleFactor(0.7)
            stepButton("plus", label: V9("v9v.days.more"), step: 1)
        }
    }

    private func stepButton(_ symbol: String, label: String, step: Int) -> some View {
        Button {
            if editable { rx.setDuration(key: line.key, days: Int32(V9Dose.days(Int(line.durationDays), step: step))) }
        } label: {
            Image(systemName: symbol).font(.system(size: 15, weight: .bold)).foregroundStyle(theme.roles.onSurface.color)
                .frame(width: 44, height: 44).background(theme.roles.surface3.color, in: Circle())
        }
        .buttonStyle(.skPressable)
        .accessibilityLabel(label)
    }
}

/// The allergy swap card: what clashed, a way to take the medicine off and the reason to override.
/// Swap suggestions need the server (Preview).
private struct V9AllergyCard: View {
    let rx: RxSheetStateHolder
    let state: RxSheetState

    var body: some View {
        AlertCard {
            Text("c.rx.allergy.title", tableName: "ClinicalV7").v7Text(15, .heavy)
            ForEach(Array(state.warnings.enumerated()), id: \.offset) { _, warning in
                Text(warning.text).v7Text(12.5)
                SkPillButton(CLf("c.rx.allergy.remove", warning.drug), wide: true) { rx.remove(key: warning.lineKey) }
            }
            ForEach(Array(state.serverAlerts.enumerated()), id: \.offset) { _, alert in
                Text(alert.message).v7Text(12.5)
            }
            if state.serverAlert, state.serverAlerts.isEmpty { Text("rx.server_alert").v7Text(12.5) }
            SkField(String(localized: "rx.override.label"), text: Binding(get: { state.overrideReason }, set: { rx.setOverrideReason(text: $0) }))
            Text("rx.override.help").v7Text(11.5)
            PreviewNotice(text: CL("c.rx.swap.preview"))
        }
    }
}
