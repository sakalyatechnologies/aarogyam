import AarogyamShared
import SakalyaUI
import SwiftUI

/// Writes and issues a prescription in the v7 sheet; once issued the same sheet turns into the
/// delivery sheet (WhatsApp, SMS, Print). [visitId] ties it to the open visit when it comes from
/// the Visit screen; [phone] is the patient's number, for the masked line and the delivery link.
struct RxSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let allergies: [AllergyView]
    var phone: String?
    var visitId: String?

    var body: some View {
        ScreenHost(make: make, state: { $0.state }) { holder, state in
            RxSheetContent(holder: holder, state: state, phone: phone)
                // The delivery sheet is short; composing needs the room.
                .presentationDetents(state.phase == .issued ? [.medium, .large] : [.large])
        }
    }

    private func make(_ screen: ScreenScope) -> RxSheetStateHolder {
        if let visitId {
            return graph.rxSheetInVisit(clinic: clinic, patientId: patientId, allergies: allergies, visitId: visitId, screen: screen)
        }
        return graph.rxSheet(clinic: clinic, patientId: patientId, allergies: allergies, screen: screen)
    }
}

private struct RxSheetContent: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    let phone: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
                SkSheetHeader(
                    state.phase == .issued ? String(localized: "rx.issued.title") : CL("c.rx.title"),
                    subtitle: subtitle
                )
                if !state.allowed {
                    Text("rx.sheet.not_allowed").font(.system(size: 13.5))
                } else if state.phase == .issued {
                    RxDelivery(holder: holder, state: state, phone: phone) { dismiss() }
                } else {
                    RxComposer(holder: holder, state: state)
                }
            }
            .padding(.horizontal, SkSheetSizes.paddingH)
            .padding(.top, SkSheetSizes.paddingTop + SkSheetSizes.grabGap)
            .padding(.bottom, SkSheetSizes.paddingBottom)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .skSheet()
    }

    private var subtitle: String? {
        if let number = state.issued?.number { return number }
        return ClinicalFormat.maskedPhone(phone).map { CLf("c.rx.to", $0) }
    }
}

private struct RxComposer: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState
    @Environment(\.skTheme) private var theme

    var body: some View {
        let locked = state.phase == .issuing
        SkSearchField(text: Binding(get: { state.query }, set: { holder.search(query: $0) }), prompt: String(localized: "rx.search"))
        VStack(spacing: 6) {
            ForEach(state.results, id: \.id) { drug in
                Button { holder.add(drug: drug) } label: {
                    SheetLine {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(drug.name).font(.system(size: 14, weight: .bold)).foregroundStyle(theme.roles.onSurface.color)
                            Text(drug.subtitleText).font(.system(size: 12)).foregroundStyle(theme.roles.onSurfaceVariant.color)
                        }
                    }
                }
                .buttonStyle(.skPressable)
            }
        }
        if state.lines.isEmpty && state.results.isEmpty {
            SkPillButton(String(localized: "rx.quick"), variant: .tonal, wide: true) { holder.quickRx() }
        }
        ForEach(state.lines, id: \.key) { RxLineCard(holder: holder, line: $0, editable: !locked) }
        if state.needsOverride { RxAllergyCard(holder: holder, state: state) }
        if let error = state.error {
            Text(error.message).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.roles.error.color)
        }
        SkPillButton(locked ? String(localized: "rx.issuing") : String(localized: "rx.issue"), variant: .warm, wide: true, loading: locked) { holder.issue() }
            .disabled(!state.canIssue)
    }
}

/// The allergy swap card: what clashed, a way to take the medicine off, and the reason to
/// override. Swap suggestions need the server (preview).
private struct RxAllergyCard: View {
    let holder: RxSheetStateHolder
    let state: RxSheetState

    var body: some View {
        AlertCard {
            Text("c.rx.allergy.title", tableName: "ClinicalV7").font(.system(size: 15, weight: .heavy))
            ForEach(Array(state.warnings.enumerated()), id: \.offset) { _, warning in
                Text(warning.text).font(.system(size: 12.5))
                SkPillButton(CLf("c.rx.allergy.remove", warning.drug), wide: true) { holder.remove(key: warning.lineKey) }
            }
            ForEach(Array(state.serverAlerts.enumerated()), id: \.offset) { _, alert in
                Text(alert.message).font(.system(size: 12.5))
            }
            if state.serverAlert, state.serverAlerts.isEmpty { Text("rx.server_alert").font(.system(size: 12.5)) }
            SkField(
                String(localized: "rx.override.label"),
                text: Binding(get: { state.overrideReason }, set: { holder.setOverrideReason(text: $0) })
            )
            Text("rx.override.help").font(.system(size: 11.5))
            PreviewNotice(text: CL("c.rx.swap.preview"))
        }
    }
}

private struct RxLineCard: View {
    let holder: RxSheetStateHolder
    let line: RxLine
    let editable: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        SheetLine {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(line.name).font(.system(size: 14.5, weight: .bold)).foregroundStyle(theme.roles.onSurface.color)
                        if !line.detail.isEmpty {
                            Text(line.detail).font(.system(size: 12)).foregroundStyle(theme.roles.onSurfaceVariant.color)
                        }
                    }
                    Spacer(minLength: 8)
                    if editable {
                        Button(String(localized: "rx.remove"), role: .destructive) { holder.remove(key: line.key) }
                            .font(.system(size: 13, weight: .bold)).frame(minHeight: 44)
                            .accessibilityLabel(String(format: String(localized: "rx.remove.named"), line.name))
                    }
                }
                presets(RxPresets.shared.doses, selected: line.dose, text: { $0 }) { holder.setDose(key: line.key, dose: $0) }
                presets(RxPresets.shared.frequencies, selected: line.frequency, text: { $0 }) { holder.setFrequency(key: line.key, frequency: $0) }
                presets(RxPresets.shared.durations.map(\.intValue), selected: Int(line.durationDays), text: { RxFormat.days($0) }) {
                    holder.setDuration(key: line.key, days: Int32($0))
                }
            }
        }
    }

    private func presets<T: Hashable>(_ options: [T], selected: T, text: @escaping (T) -> String, pick: @escaping (T) -> Void) -> some View {
        SkChoiceChips(options.contains(selected) ? options : [selected] + options, selected: [selected], label: text) { if editable { pick($0) } }
    }
}
