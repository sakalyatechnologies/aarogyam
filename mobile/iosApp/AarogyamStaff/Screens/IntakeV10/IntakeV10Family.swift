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
            // The app's FlowLayout, not SkChoiceChips: SkFlowLayout can wrap the last chip of its widest row over the
            // next section (pixel rounding; a kit fix is pending).
            FlowLayout(spacing: 8) {
                SkChoiceChip(iv("iv.family.none"), selected: anchor == nil) { anchor = nil }
                ForEach(people, id: \.self) { person in
                    SkChoiceChip(person.name, selected: anchor == person) { anchor = person }
                }
            }
            if anchor != nil {
                V7Label(text: dv("d9.family.relation"))
                FlowLayout(spacing: 8) {
                    ForEach(DeskRelation.allCases, id: \.self) { r in
                        SkChoiceChip(r.title, selected: relation == r) { relation = r }
                    }
                }
            }
        }
        .onChange(of: anchor) { _, _ in send() }
        .onChange(of: relation) { _, _ in send() }
    }

    private func send() {
        holder.setFamilyOf(patientId: anchor?.id, relation: relation.wire)
    }
}
