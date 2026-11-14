import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Family of" on the intake form, when the number already has patients: none is picked at first, so a
/// new patient who only shares the phone costs no taps. Picking a person shows the relation chips;
/// the server links the two on save (`family_of`).
struct IntakeV10Family: View {
    let holder: IntakeFormHolder
    let people: [DeskFamilyAnchor]
    @State private var anchor: DeskFamilyAnchor?
    @State private var relation: DeskRelation = .child
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            V7Label(text: dv("d9.family.of_whom"))
            SkChoiceChips(
                [nil] + people.map { Optional($0) },
                selected: [anchor],
                label: { $0?.name ?? iv("iv.family.none") },
                onToggle: { anchor = $0 }
            )
            if anchor != nil {
                V7Label(text: dv("d9.family.relation"))
                SkChoiceChips(DeskRelation.allCases, selected: [relation], label: { $0.title }) { relation = $0 }
            }
        }
        .onChange(of: anchor) { _, _ in send() }
        .onChange(of: relation) { _, _ in send() }
    }

    private func send() {
        holder.setFamilyOf(patientId: anchor?.id, relation: relation.wire)
    }
}
