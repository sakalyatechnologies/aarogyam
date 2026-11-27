import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Case-paper details" of an existing patient (`GET` and `PUT /patients/{id}/intake`). A phone the server masked
/// (no patients.contact) shows as it came, read-only, and goes back unchanged.
struct IntakeEditSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let female: Bool

    var body: some View {
        ScreenHost(make: { graph.intakeEdit(clinic: clinic, patientId: patientId, female: female, screen: $0) }, state: { $0.state }) { holder, state in
            IntakeEditBody(holder: holder, state: state)
        }
    }
}

private struct IntakeEditBody: View {
    let holder: IntakeEditHolder
    let state: IntakeEditState
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(iv("iv.edit.title"))
                switch onEnum(of: state) {
                case .loading: SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xl)
                case .notAllowed: Text(iv("iv.edit.not_allowed")).font(.callout)
                case .failed(let failed):
                    SkEmptyState(iv("iv.edit.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .editing(let editing): fields(editing)
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
    }

    @ViewBuilder private func fields(_ e: IntakeEditStateEditing) -> some View {
        let d = e.details
        GroupedHeader(iv("iv.sec.personal"))
        picks(e.options?.bloodGroups ?? [], d.bloodGroup, iv("iv.blood"), .bloodGroup)
        text(e, .occupation, iv("iv.occupation"), d.occupation)
        GroupedHeader(iv("iv.sec.contact"))
        phone(e, .altPhone, iv("iv.alt.phone"), d.altPhone, .altPhone)
        text(e, .emergencyName, iv("iv.emergency.name"), d.emergencyName)
        phone(e, .emergencyPhone, iv("iv.emergency.phone"), d.emergencyPhone, .emergencyPhone)
        picks(e.options?.callTimes ?? [], d.callTime, iv("iv.call.time"), .callTime)
        text(e, .doctorName, iv("iv.doctor.name"), d.doctorName)
        phone(e, .doctorPhone, iv("iv.doctor.phone"), d.doctorPhone, .doctorPhone)
        text(e, .doctorAddress, iv("iv.doctor.address"), d.doctorAddress)
        GroupedHeader(iv("iv.sec.found"))
        picks(e.options?.heardVia ?? [], d.heardVia, iv("iv.heard"), .heardVia)
        if !d.heardVia.isEmpty { text(e, .heardViaText, iv("iv.heard.text"), d.heardViaText) }
        text(e, .referredBy, iv("iv.referred"), d.referredBy)
        GroupedHeader(iv("iv.sec.medical"))
        text(e, .healthOther, iv("iv.health.other"), d.healthOther)
        if e.female {
            GroupedHeader(iv("iv.sec.women"))
            yesNo(iv("iv.pregnant"), d.pregnant) { holder.setPregnant(value: $0) }
            if d.pregnant?.boolValue == true {
                SkField(iv("iv.due.date"), text: Binding(get: { d.dueDate }, set: { holder.setDetail(field: .dueDate, text: $0) }),
                        placeholder: iv("iv.due.hint"), error: e.errors[.dueDate].map { _ in iv("iv.err.invalid") }, keyboard: .numberPad)
            }
            yesNo(iv("iv.nursing"), d.nursing) { holder.setNursing(value: $0) }
        }
        if let error = e.saveError { Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.error.color) }
        if e.saved { Text(iv("iv.edit.saved")).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.onSurfaceVariant.color) }
        SkPillButton(iv("iv.edit.save"), wide: true, loading: e.saving) { holder.save() }
    }

    private func text(_ e: IntakeEditStateEditing, _ f: DetailField, _ label: String, _ value: String) -> some View {
        SkField(label, text: Binding(get: { value }, set: { holder.setDetail(field: f, text: $0) }))
    }

    /// A phone: the masked text read-only when the server hid it, else a number field.
    @ViewBuilder private func phone(_ e: IntakeEditStateEditing, _ f: DetailField, _ label: String, _ value: String, _ key: IntakeField) -> some View {
        if let masked = e.masked[f] {
            VStack(alignment: .leading, spacing: 2) {
                V7Label(text: label)
                Text(masked).font(.callout).foregroundStyle(theme.roles.onSurfaceVariant.color)
            }
            .accessibilityElement(children: .combine)
        } else {
            SkField(label, text: Binding(get: { value }, set: { holder.setDetail(field: f, text: $0) }),
                    error: e.errors[key].map { _ in iv("iv.err.invalid") }, contentType: .telephoneNumber, keyboard: .phonePad)
        }
    }

    @ViewBuilder private func picks(_ choices: [CheckInChoice], _ selected: String, _ title: String, _ f: DetailField) -> some View {
        if !choices.isEmpty {
            V7Label(text: title)
            V7Flow(spacing: 8) {
                ForEach(choices, id: \.code) { c in
                    GlassChip(text: c.label, selected: c.code == selected, check: true) { holder.setDetail(field: f, text: c.code) }
                }
            }
        }
    }

    private func yesNo(_ title: String, _ value: KotlinBoolean?, set: @escaping (KotlinBoolean?) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            V7Label(text: title)
            HStack(spacing: 8) {
                GlassChip(text: iv("iv.yes"), selected: value?.boolValue == true, check: true) { set(value?.boolValue == true ? nil : KotlinBoolean(bool: true)) }
                GlassChip(text: iv("iv.no"), selected: value?.boolValue == false, check: true) { set(value?.boolValue == false ? nil : KotlinBoolean(bool: false)) }
            }
        }
    }
}
