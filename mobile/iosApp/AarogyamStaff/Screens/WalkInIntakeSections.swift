import AarogyamShared
import SwiftUI

/// Allergies (patient-reported until the doctor confirms), consent read aloud, and the doctor.
struct WalkInIntakeSections: View {
    let holder: WalkInStateHolder
    let form: WalkInForm

    var body: some View {
        Section {
            CheckRow(title: String(localized: "walk_in.no_known_allergies"), isOn: form.noKnownAllergies) {
                holder.toggleNoKnownAllergies()
            }
            ForEach(form.allergyPicks, id: \.self) { label in
                CheckRow(title: label, isOn: form.allergies.contains(label)) { holder.toggleAllergy(label: label) }
            }
        } header: {
            Text("walk_in.allergies")
        } footer: {
            Text("walk_in.allergies.hint")
        }

        Section {
            Text("walk_in.consent.read").font(.callout)
            Toggle(String(localized: "walk_in.consent.care"), isOn: .constant(true)).disabled(true)
            Toggle(
                String(localized: "walk_in.consent.reminders"),
                isOn: Binding(get: { form.reminders }, set: { holder.setReminders(on: $0) })
            )
        } header: {
            Text("walk_in.consent")
        }

        if !form.doctors.isEmpty {
            Section {
                Picker(String(localized: "walk_in.doctor"), selection: Binding(get: { form.doctorId }, set: { holder.setDoctor(id: $0) })) {
                    Text("walk_in.doctor.any").tag(String?.none)
                    ForEach(form.doctors, id: \.id) { doctor in
                        Text(doctor.name).tag(Optional(doctor.id))
                    }
                }
            }
        }
    }
}
