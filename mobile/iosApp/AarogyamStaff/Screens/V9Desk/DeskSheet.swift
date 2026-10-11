import AarogyamShared
import SakalyaUI
import SwiftUI

/// Who a payment sheet is for. Carries the id and a display name, never logged.
struct DeskPayTarget: Identifiable, Hashable {
    let patientId: String
    let name: String
    var id: String { patientId }
}

/// The Walk-in action's sheet: the front desk's lookup by mobile number first, then the existing
/// walk-in form (with the number filled in) for a new patient or a family member.
struct DeskSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext

    enum Mode: Equatable {
        case lookup
        case form(phone: String, family: Bool)
    }

    @State private var mode: Mode = DeskLaunch.firstMode
    @State private var paying: DeskPayTarget? = DeskLaunch.firstPayTarget

    var body: some View {
        Group {
            switch mode {
            case .lookup:
                ScreenHost(make: { graph.deskLookup(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    DeskLookupScreen(
                        holder: holder, state: state, clinic: clinic,
                        onNewPatient: { mode = .form(phone: $0, family: false) },
                        onFamily: { mode = .form(phone: $0, family: true) },
                        onCollect: { paying = $0 }
                    )
                }
            case .form(let phone, let family):
                ScreenHost(make: { graph.walkIn(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    DeskFormScreen(holder: holder, state: state, phone: phone, family: family) { mode = .lookup }
                }
            }
        }
        .sheet(item: $paying) { target in DeskPaymentSheet(graph: graph, clinic: clinic, target: target) }
    }
}

/// The existing walk-in form with the number filled in. For a family member it adds the relation
/// picker, which stays a Preview until the server keeps family links (BE1).
private struct DeskFormScreen: View {
    let holder: WalkInStateHolder
    let state: WalkInState
    let phone: String
    let family: Bool
    let onBack: () -> Void
    @State private var relation: DeskRelation = .guardian
    @State private var filled = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button(action: onBack) {
                    Label { Text(dv("d9.back")) } icon: { V7Icon(name: "back", size: 18, tint: theme.roles.primary.color) }
                        .labelStyle(.titleAndIcon).v7Text(14, .semibold).foregroundStyle(theme.roles.primary.color)
                        .frame(minHeight: SkSpacing.minTouchTarget)
                }
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 14)
            if family { familyBar }
            WalkInScreen(holder: holder, state: state)
        }
        .onAppear {
            guard !filled else { return }
            filled = true
            holder.setMobile(typed: phone)
            holder.someoneNew()
        }
    }

    private var familyBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(dv("d9.family.title")).v7Text(15, .bold).foregroundStyle(theme.roles.onSurface.color)
            Text(dvf("d9.family.number", DeskPhone.format(String(phone.suffix(DeskPhone.length)))))
                .v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
            V7Label(text: dv("d9.family.relation"))
            SkChoiceChips(DeskRelation.allCases, selected: [relation], label: { $0.title }) { relation = $0 }
            PreviewNotice()
        }
        .padding(.horizontal, 18).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// How a family member relates to the number's owner (BE1's `patient_relations`).
enum DeskRelation: CaseIterable, Hashable {
    case guardian, child, spouse, other

    var title: String {
        switch self {
        case .guardian: dv("d9.rel.guardian")
        case .child: dv("d9.rel.child")
        case .spouse: dv("d9.rel.spouse")
        case .other: dv("d9.rel.other")
        }
    }
}
