import AarogyamShared
import SakalyaUI
import SwiftUI

/// The patient's relatives as tappable chips ("Parent of Asha", "Child of Ravi") under the details; a tap
/// pushes that profile. Nothing shows without relatives or `patients.read`.
struct PatientFamilyChips: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String

    var body: some View {
        ScreenHost(make: { graph.family(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { _, state in
            if case .loaded(let loaded) = onEnum(of: state), !loaded.items.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(loaded.items, id: \.linkId) { person in
                        NavigationLink(value: PatientRoute(id: person.patientId)) {
                            Text(String(format: PatientFamilyChips.text(person.chip()), person.name))
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(.quaternary, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, SkSpacing.l).padding(.vertical, 8)
            }
        }
    }

    static func text(_ chip: FamilyChip) -> String {
        switch chip {
        case .parentOf: iv("iv.fam.chip.parent_of")
        case .childOf: iv("iv.fam.chip.child_of")
        case .spouseOf: iv("iv.fam.chip.spouse_of")
        case .siblingOf: iv("iv.fam.chip.sibling_of")
        case .wardOf: iv("iv.fam.chip.ward_of")
        case .relatedTo: iv("iv.fam.chip.related_to")
        }
    }
}
