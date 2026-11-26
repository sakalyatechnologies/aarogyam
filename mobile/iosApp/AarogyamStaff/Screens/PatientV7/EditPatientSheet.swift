import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Edit details": name, mobile number, sex, date of birth (or age) and the optional address
/// (`PATCH /patients/{id}`). A saved edit reloads the page through `onSaved`.
struct EditPatientSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let view: PatientView
    let onSaved: () -> Void

    var body: some View {
        ScreenHost(make: { graph.patientEdit(clinic: clinic, view: view, screen: $0) }, state: { $0.state }) { holder, form in
            EditBody(holder: holder, form: form, number: view.number, onSaved: onSaved)
        }
    }
}

private struct EditBody: View {
    let holder: PatientEditStateHolder
    let form: PatientEditForm
    let number: String
    let onSaved: () -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(pv("pv.edit.title"), subtitle: number)
                SkField(pv("pv.edit.name"), text: Binding(get: { form.name }, set: { holder.setName(text: $0) }), contentType: .name)
                if form.canEditPhone {
                    SkField(pv("pv.edit.phone"), text: Binding(get: { form.phone }, set: { holder.setPhone(text: $0) }), contentType: .telephoneNumber, keyboard: .phonePad)
                } else {
                    V7Muted(pv("pv.edit.phone_locked"))
                }
                Text(pv("pv.edit.sex")).font(.system(size: 12, weight: .bold)).foregroundStyle(r.onSurfaceVariant.color)
                Picker(pv("pv.edit.sex"), selection: Binding(get: { form.sex }, set: { if let sex = $0 { holder.setSex(value: sex) } })) {
                    ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in Text(sex.label ?? "").tag(Optional(sex)) }
                }
                .pickerStyle(.segmented)
                SkField(pv("pv.edit.birth"), text: Binding(get: { form.birthDate }, set: { holder.setBirthDate(text: $0) }), keyboard: .numbersAndPunctuation)
                if form.birthDate.isEmpty {
                    SkField(pv("pv.edit.age"), text: Binding(get: { form.age }, set: { holder.setAge(text: $0) }), error: nil, keyboard: .numberPad)
                    V7Muted(pv("pv.edit.age_hint"))
                }
                GroupedHeader(String(localized: "address.title"))
                AddressFields(address: form.address) { holder.setAddress(field: $0, text: $1) }
                if let problem = form.problem {
                    Text(message(problem)).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                }
                if let error = form.error {
                    Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                }
                SkPillButton(pv("pv.edit.save"), wide: true) { holder.save() }.disabled(form.saving)
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .skSheet()
        .onChange(of: form.saved) { _, saved in
            if saved { onSaved(); dismiss() }
        }
    }

    private func message(_ problem: PatientEditProblem) -> String {
        switch problem {
        case .nameRequired: pv("pv.edit.name_required")
        case .birthDateInvalid: pv("pv.edit.birth_invalid")
        case .ageInvalid: pv("pv.edit.age_invalid")
        case .changed: pv("pv.edit.changed")
        }
    }
}
