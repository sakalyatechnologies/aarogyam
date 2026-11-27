import AarogyamShared
import SakalyaUI
import SwiftUI

/// Personal, Contact, Medical history and (for a female patient) For women: every field optional, shown with
/// intake.write. The lists come from `GET /patients/intake-options`.
struct IntakeV10Case: View {
    let holder: IntakeFormHolder
    let form: IntakeForm

    var body: some View {
        if form.showDetails {
            let d = form.details
            VStack(alignment: .leading, spacing: 12) {
                GroupedHeader(iv("iv.sec.personal"))
                picks(form.options?.bloodGroups ?? [], selected: d.bloodGroup, title: iv("iv.blood"), field: .bloodGroup)
                text(.occupation, iv("iv.occupation"), d.occupation)

                GroupedHeader(iv("iv.sec.contact"))
                SkField(iv("iv.email"), text: Binding(get: { form.email }, set: { holder.setEmail(text: $0) }),
                        error: form.errors[.email].map { IntakeV10Logic.problemText(.email, $0) },
                        contentType: .emailAddress, keyboard: .emailAddress)
                text(.altPhone, iv("iv.alt.phone"), d.altPhone, keyboard: .phonePad, error: .altPhone)
                text(.emergencyName, iv("iv.emergency.name"), d.emergencyName)
                text(.emergencyPhone, iv("iv.emergency.phone"), d.emergencyPhone, keyboard: .phonePad, error: .emergencyPhone)
                picks(form.options?.callTimes ?? [], selected: d.callTime, title: iv("iv.call.time"), field: .callTime)
                V7Label(text: iv("iv.language"))
                V7Flow(spacing: 8) {
                    ForEach([("", "English"), ("hi-IN", "हिन्दी"), ("mr-IN", "मराठी")], id: \.0) { code, name in
                        GlassChip(text: name, selected: d.language == code, check: true) { holder.setDetail(field: .language, text: code) }
                    }
                }
                text(.doctorName, iv("iv.doctor.name"), d.doctorName)
                text(.doctorPhone, iv("iv.doctor.phone"), d.doctorPhone, keyboard: .phonePad, error: .doctorPhone)
                text(.doctorAddress, iv("iv.doctor.address"), d.doctorAddress)

                GroupedHeader(iv("iv.sec.found"))
                picks(form.options?.heardVia ?? [], selected: d.heardVia, title: iv("iv.heard"), field: .heardVia)
                if !d.heardVia.isEmpty { text(.heardViaText, iv("iv.heard.text"), d.heardViaText) }
                text(.referredBy, iv("iv.referred"), d.referredBy)

                GroupedHeader(iv("iv.sec.medical"))
                V7Flow(spacing: 8) {
                    ForEach(IntakeDetailsKt.medicalChecklist(flags: form.options?.healthFlags), id: \.code) { flag in
                        GlassChip(text: flag.label, selected: d.health.contains(flag.code), check: true) { holder.toggleHealth(code: flag.code) }
                    }
                    GlassChip(text: iv("iv.health.none"), selected: d.health.contains(IntakeDetailsKt.HEALTH_NONE), check: true) {
                        holder.toggleHealth(code: IntakeDetailsKt.HEALTH_NONE)
                    }
                }
                text(.healthOther, iv("iv.health.other"), d.healthOther)
                text(.allergiesText, iv("iv.allergies.text"), d.allergiesText)

                if form.showWomen {
                    GroupedHeader(iv("iv.sec.women"))
                    yesNo(iv("iv.pregnant"), d.pregnant) { holder.setPregnant(value: $0) }
                    if d.pregnant?.boolValue == true {
                        text(.dueDate, iv("iv.due.date"), d.dueDate, placeholder: iv("iv.due.hint"), keyboard: .numberPad, error: .dueDate)
                    }
                    yesNo(iv("iv.nursing"), d.nursing) { holder.setNursing(value: $0) }
                }
            }
        }
    }

    private func text(_ f: DetailField, _ label: String, _ value: String, placeholder: String = "",
                      keyboard: UIKeyboardType = .default, error: IntakeField? = nil) -> some View {
        SkField(label, text: Binding(get: { value }, set: { holder.setDetail(field: f, text: $0) }), placeholder: placeholder,
                error: error.flatMap { e in form.errors[e].map { IntakeV10Logic.problemText(e, $0) } }, keyboard: keyboard)
    }

    @ViewBuilder private func picks(_ choices: [CheckInChoice], selected: String, title: String, field: DetailField) -> some View {
        if !choices.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                V7Label(text: title)
                V7Flow(spacing: 8) {
                    ForEach(choices, id: \.code) { choice in
                        GlassChip(text: choice.label, selected: choice.code == selected, check: true) {
                            holder.setDetail(field: field, text: choice.code)
                        }
                    }
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

/// Under the mobile field: "Already registered: Name, age, SC-xxxx" for each patient on the typed number, with Open
/// profile, Book (when the form can book) and "Add family member on this number" (with the relation chips after).
struct IntakeV10Lookup: View {
    let holder: IntakeFormHolder
    let form: IntakeForm
    var ends: IntakeEnds = IntakeEnds()
    @Environment(\.skTheme) private var theme

    var body: some View {
        if case .matches(let matches) = onEnum(of: form.lookup) {
            VStack(spacing: 8) {
                ForEach(matches.items, id: \.id) { row in card(row) }
            }
        }
    }

    private func card(_ row: PhoneMatchRow) -> some View {
        let linked = form.familyOf.flatMap { $0.patientId == row.id ? $0 : nil }
        return VStack(alignment: .leading, spacing: 8) {
            Text(found(row)).font(.callout.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            FlowLayout(spacing: 8) {
                if let open = ends.onOpen { SkPillButton(iv("iv.open_profile"), variant: .tonal) { open(row.id) } }
                if let book = ends.onBook { SkPillButton(iv("iv.book"), variant: .tonal) { book(row.id, row.name) } }
                if form.showFamily, linked == nil {
                    SkPillButton(iv("iv.add.family"), variant: .tonal) { holder.addFamilyOnNumber(patientId: row.id) }
                }
            }
            if let linked {
                V7Label(text: String(format: iv("iv.family.relation"), row.name))
                FlowLayout(spacing: 8) {
                    ForEach(DeskRelation.allCases, id: \.self) { relation in
                        SkChoiceChip(relation.title, selected: linked.relation == relation.wire) {
                            holder.setFamilyOf(patientId: row.id, relation: relation.wire)
                        }
                    }
                }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.roles.surface3.color, in: RoundedRectangle(cornerRadius: 12))
    }

    private func found(_ row: PhoneMatchRow) -> String {
        if let age = row.ageYears {
            return String(format: iv("iv.found"), row.name, age.intValue, row.number)
        }
        return String(format: iv("iv.found.no.age"), row.name, row.number)
    }
}
