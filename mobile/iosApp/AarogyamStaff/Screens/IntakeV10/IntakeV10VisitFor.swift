import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Who is the visit for?": the patient alone (default), or family members who each get a profile and a link.
struct IntakeV10VisitFor: View {
    let holder: IntakeFormHolder
    let form: IntakeForm

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            GroupedHeader(iv("iv.for.title"))
            SkSegmented([iv("iv.for.self"), iv("iv.for.family")], selectedIndex: form.forFamily ? 1 : 0) {
                holder.setForFamily(on: $0 == 1)
            }
            if form.forFamily {
                ForEach(Array(form.members.enumerated()), id: \.element.key) { index, member in
                    IntakeV10Member(holder: holder, form: form, member: member, number: index + 1)
                }
                if form.errors[.members] != nil {
                    Text(iv("iv.err.members")).font(.footnote.weight(.semibold)).foregroundStyle(.red)
                }
                SkPillButton(iv("iv.member.add"), variant: .tonal, wide: true) { holder.addMember() }
            }
        }
    }
}

private struct IntakeV10Member: View {
    let holder: IntakeFormHolder
    let form: IntakeForm
    let member: FamilyMemberForm
    let number: Int
    @State private var useAge = true

    var body: some View {
        let problems = form.memberErrors[KotlinInt(int: member.key)]
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                GroupedHeader(String(format: iv("iv.member.title"), number))
                Spacer()
                SkPillButton(iv("iv.member.remove"), variant: .ghost) { holder.removeMember(key: member.key) }
            }
            field(.name, problems, label: iv("iv.name"), text: member.name, type: .name) {
                holder.setMemberName(key: member.key, text: $0)
            }
            SkSegmented([iv("iv.age"), iv("iv.dob")], selectedIndex: useAge ? 0 : 1) { useAge = $0 == 0 }
            if useAge {
                field(.birth, problems, label: iv("iv.age"), text: member.age, keyboard: .numberPad) {
                    holder.setMemberAge(key: member.key, text: $0)
                }
            } else {
                field(.birth, problems, label: iv("iv.dob"), text: member.dateOfBirth, placeholder: iv("iv.dob.hint"),
                      keyboard: .numberPad) {
                    holder.setMemberDateOfBirth(key: member.key, text: IntakeV10Logic.dateText($0))
                }
            }
            GroupedHeader(iv("iv.sex"))
            HStack(spacing: 8) {
                ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in
                    GlassChip(text: sex.label ?? "", selected: member.sex == sex, check: true) {
                        holder.setMemberSex(key: member.key, value: sex)
                    }
                }
            }
            GroupedHeader(iv("iv.member.relation"))
            FlowLayout(spacing: 8) {
                ForEach([MemberRelation.child, .spouse, .parent], id: \.self) { relation in
                    SkChoiceChip(DeskRelation.title(wire: relation.wire), selected: member.relation == relation) {
                        holder.setMemberRelation(key: member.key, relation: relation)
                    }
                }
            }
            field(.phone, problems, label: iv("iv.member.phone"), text: member.phone, type: .telephoneNumber,
                  keyboard: .phonePad) { holder.setMemberPhone(key: member.key, typed: $0) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).strokeBorder(.quaternary))
    }

    private func field(_ f: IntakeField, _ problems: [IntakeField: IntakeProblem]?, label: String, text: String,
                       placeholder: String = "", type: UITextContentType? = nil, keyboard: UIKeyboardType = .default,
                       set: @escaping (String) -> Void) -> some View {
        SkField(label, text: Binding(get: { text }, set: set), placeholder: placeholder,
                error: problems?[f].map { IntakeV10Logic.problemText(f, $0) }, contentType: type, keyboard: keyboard)
    }
}

/// After saving: which family members were not made or not linked (the others are saved).
struct IntakeV10FamilyOutcome: View {
    let results: [FamilyResult]
    @Environment(\.skTheme) private var theme

    var body: some View {
        ForEach(results.filter(\.failed), id: \.key) { result in
            Text(String(format: iv(result.patientId == nil ? "iv.done.family.failed" : "iv.done.family.unlinked"), result.name))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.roles.error.color)
                .multilineTextAlignment(.center)
        }
    }
}
