import AarogyamShared
import SwiftUI

/// Mobile first; registered patients with the number show as soon as it is complete.
struct WalkInMobileSection: View {
    let holder: WalkInStateHolder
    let form: WalkInForm

    var body: some View {
        Section {
            TextField(
                String(localized: "walk_in.mobile"),
                text: Binding(get: { form.mobile }, set: { holder.setMobile(typed: $0) })
            )
            .keyboardType(.phonePad)
            .textContentType(.telephoneNumber)
            lookup
        } header: {
            Text("walk_in.mobile")
        } footer: {
            Text("walk_in.mobile.hint")
        }
    }

    @ViewBuilder private var lookup: some View {
        switch onEnum(of: form.lookup) {
        case .idle:
            EmptyView()
        case .looking:
            HStack { ProgressView(); Text("walk_in.looking").foregroundStyle(.secondary) }
        case .failed:
            Text("walk_in.lookup_failed").foregroundStyle(.secondary)
        case .matches(let matches):
            if matches.items.isEmpty { Text("walk_in.no_match").foregroundStyle(.secondary) }
            ForEach(matches.items, id: \.id) { match in
                CheckRow(title: "\(match.name) · \(patientLine(number: match.number, ageYears: match.ageYears?.intValue, sex: match.sex))", isOn: isChosen(match)) {
                    holder.pick(match: match)
                }
            }
            CheckRow(title: String(localized: "walk_in.someone_new"), isOn: isNew) { holder.someoneNew() }
        }
    }

    private func isChosen(_ match: PhoneMatchRow) -> Bool {
        if case .existing(let who) = onEnum(of: form.who) { who.id == match.id } else { false }
    }

    private var isNew: Bool {
        if case .new = onEnum(of: form.who) { true } else { false }
    }
}

/// Name, age and sex for someone not registered yet.
struct WalkInNewPatientSection: View {
    let holder: WalkInStateHolder
    let form: WalkInForm

    var body: some View {
        Section {
            TextField(String(localized: "walk_in.name"), text: Binding(get: { form.name }, set: { holder.setName(text: $0) }))
                .textContentType(.name)
            TextField(String(localized: "walk_in.age"), text: Binding(get: { form.age }, set: { holder.setAge(text: $0) }))
                .keyboardType(.numberPad)
            Picker(String(localized: "walk_in.sex"), selection: Binding(get: { form.sex }, set: { if let sex = $0 { holder.setSex(value: sex) } })) {
                ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in
                    Text(sex.label ?? "").tag(Optional(sex))
                }
            }
            .pickerStyle(.segmented)
        }
    }
}
