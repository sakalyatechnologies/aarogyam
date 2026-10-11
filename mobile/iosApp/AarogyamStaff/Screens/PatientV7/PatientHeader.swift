import AarogyamShared
import SakalyaUI
import SwiftUI

/// What a header flag says, and how loudly: a severe allergy is red, other findings warm, the rest plain.
struct PatientFlag: Identifiable, Equatable {
    enum Tone { case red, warm, plain }
    let id: String
    let text: String
    let tone: Tone

    /// The flags a patient shows: allergies, conditions, recall and the balance. A role without `clinical.read` sees counts only.
    static func flags(for view: PatientView) -> [PatientFlag] {
        var out: [PatientFlag] = []
        let f = view.flags
        if f.detailsHidden {
            if f.allergyCount > 0 { out.append(PatientFlag(id: "a", text: pvf("pv.flag.allergies", Int(f.allergyCount)), tone: f.severeAllergy ? .red : .warm)) }
            if f.conditionCount > 0 { out.append(PatientFlag(id: "c", text: pvf("pv.flag.conditions", Int(f.conditionCount)), tone: .warm)) }
        } else {
            for (i, a) in f.allergies.enumerated() { out.append(PatientFlag(id: "a\(i)", text: a.substance, tone: a.severity == .severe ? .red : .warm)) }
            for (i, c) in f.conditions.enumerated() { out.append(PatientFlag(id: "c\(i)", text: c, tone: .warm)) }
        }
        if view.recallDue { out.append(PatientFlag(id: "r", text: pv("pv.flag.recall"), tone: .warm)) }
        if let due = view.balancePaise?.int64Value, due > 0 {
            out.append(PatientFlag(id: "b", text: pvf("pv.flag.due", ClinicFormat.rupees(paise: due)), tone: .plain))
        }
        return out
    }
}

/// The tonal Patient 360 header (the mockup's `.phead`): initials, name and line, flags, and the four quick actions.
struct PatientHeader<Footer: View>: View {
    let view: PatientView
    let canBook: Bool
    var canPhoto: Bool = true
    let onBook: () -> Void
    let onPhoto: () -> Void
    @ViewBuilder let footer: Footer
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                V7Initials(name: view.name, size: 56, strong: true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(view.name).v7Text(20, .heavy).tracking(-0.2).foregroundStyle(r.onPrimaryContainer.color)
                    Text(line).v7Text(11.5).foregroundStyle(r.onPrimaryContainer.color.opacity(0.85))
                }
            }
            .accessibilityElement(children: .combine)
            let flags = PatientFlag.flags(for: view)
            if !flags.isEmpty {
                V7Flow(spacing: 6) { ForEach(flags) { flag in flagView(flag) } }
            }
            HStack(spacing: 6) {
                action("phone", pv("pv.action.call"), enabled: PatientLinks.tel(view.phone) != nil) {
                    if let url = PatientLinks.tel(view.phone) { openURL(url) }
                }
                action("wa", pv("pv.action.whatsapp"), enabled: PatientLinks.whatsApp(view.phone) != nil) {
                    if let url = PatientLinks.whatsApp(view.phone) { openURL(url) }
                }
                action("cal", pv("pv.action.book"), enabled: canBook, onBook)
                action("cam", pv("pv.action.photo"), enabled: canPhoto, onPhoto)
            }
            footer
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            UnevenRoundedRectangle(bottomLeadingRadius: 32, bottomTrailingRadius: 32, style: .continuous)
                .fill(r.primaryContainer.color)
                .ignoresSafeArea(edges: .top)
        }
    }

    /// `34 y · Female · SD-1042 · English`
    private var line: String {
        let age = view.ageYears.map { pvf("pv.age_short", $0.intValue) }
        return [age, view.sex.label, view.number, Locale.current.localizedString(forLanguageCode: view.language)].compactMap { $0 }.joined(separator: " · ")
    }

    private func flagView(_ flag: PatientFlag) -> some View {
        let r = theme.roles
        let (fill, ink): (Color, Color) = switch flag.tone {
        case .red: (r.errorContainer.color, r.onErrorContainer.color)
        case .warm: (r.tertiaryContainer.color, r.onTertiaryContainer.color)
        case .plain: (Color.white.opacity(0.55), r.onPrimaryContainer.color)
        }
        return Text(flag.text).v7Text(11.5, .bold).foregroundStyle(ink)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(fill, in: Capsule())
    }

    private func action(_ icon: String, _ title: String, enabled: Bool, _ run: @escaping () -> Void) -> some View {
        let r = theme.roles
        return Button(action: run) {
            VStack(spacing: 3) {
                V7Icon(name: icon, size: 18, tint: r.primary.color)
                Text(title).v7Text(10.5, .bold).foregroundStyle(r.onSurface.color).lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, 4)
            .background(r.background.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.skPressable)
        .disabled(!enabled)
        .accessibilityLabel(title)
    }
}

extension PatientHeader where Footer == EmptyView {
    init(view: PatientView, canBook: Bool, canPhoto: Bool = true, onBook: @escaping () -> Void, onPhoto: @escaping () -> Void) {
        self.init(view: view, canBook: canBook, canPhoto: canPhoto, onBook: onBook, onPhoto: onPhoto) { EmptyView() }
    }
}
