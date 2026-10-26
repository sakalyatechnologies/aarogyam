import AarogyamShared
import SakalyaUI
import SwiftUI

/// Who a payment sheet is for. Carries the id and a display name, never logged.
struct DeskPayTarget: Identifiable, Hashable {
    let patientId: String
    let name: String
    /// The `collect_payment` notification behind a To-pay card, when the desk knows it (v10).
    var notificationId: String?
    var id: String { patientId }
}

/// The Walk-in action's sheet: the front desk's lookup by mobile number first, then the existing
/// walk-in form (with the number filled in) for a new patient or a family member.
struct DeskSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext

    enum Mode: Equatable {
        case lookup
        case form(phone: String, family: [DeskFamilyAnchor]?)
    }

    @State private var mode: Mode
    @State private var paying: DeskPayTarget? = DeskLaunch.firstPayTarget

    init(graph: AppGraph, clinic: ClinicContext, start: Mode? = nil) {
        self.graph = graph
        self.clinic = clinic
        _mode = State(initialValue: start ?? DeskLaunch.firstMode)
    }

    var body: some View {
        Group {
            switch mode {
            case .lookup:
                ScreenHost(make: { graph.deskLookup(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    DeskLookupScreen(
                        holder: holder, state: state, graph: graph, clinic: clinic,
                        onNewPatient: { mode = .form(phone: $0, family: nil) },
                        onFamily: { mode = .form(phone: $0, family: $1) },
                        onCollect: { paying = $0 }
                    )
                }
            case .form(let phone, let family):
                ScreenHost(make: { graph.walkIn(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    DeskFormScreen(holder: holder, state: state, phone: phone, family: family) { mode = .lookup }
                }
            }
        }
        .safeAreaInset(edge: .top, alignment: .leading) { OutboxBadge(graph: graph).padding(.horizontal, SkSpacing.l) }
        .sheet(item: $paying) { target in DeskPaymentSheet(graph: graph, clinic: clinic, target: target) }
    }
}

/// The existing walk-in form with the number filled in. For a family member it adds the relation
/// picker; the server links the new patient to the chosen person (`family_of`).
private struct DeskFormScreen: View {
    let holder: WalkInStateHolder
    let state: WalkInState
    let phone: String
    /// The people on the number the new relative can be linked to; nil for a plain new patient.
    let family: [DeskFamilyAnchor]?
    let onBack: () -> Void
    @State private var relation: DeskRelation = .guardian
    @State private var anchor: DeskFamilyAnchor?
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
            if let family, ServerCaps.shared.family { familyBar(family) }
            WalkInScreen(holder: holder, state: state)
        }
        .onAppear {
            guard !filled else { return }
            filled = true
            holder.setMobile(typed: phone)
            holder.someoneNew()
            anchor = family?.first
            sendFamily()
        }
        .onChange(of: relation) { _, _ in sendFamily() }
        .onChange(of: anchor) { _, _ in sendFamily() }
    }

    private func sendFamily() {
        guard family != nil else { return }
        holder.setFamilyOf(patientId: anchor?.id, relation: relation.wire)
    }

    private func familyBar(_ people: [DeskFamilyAnchor]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(dv("d9.family.title")).v7Text(15, .bold).foregroundStyle(theme.roles.onSurface.color)
            Text(dvf("d9.family.number", DeskPhone.format(String(phone.suffix(DeskPhone.length)))))
                .v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
            if people.count > 1 {
                V7Label(text: dv("d9.family.of_whom"))
                SkChoiceChips(people, selected: anchor.map { [$0] } ?? [], label: { $0.name }) { anchor = $0 }
            } else if let only = people.first {
                Text(dvf("d9.family.of", only.name)).v7Text(12.5, .semibold).foregroundStyle(theme.roles.primary.color)
            }
            V7Label(text: dv("d9.family.relation"))
            SkChoiceChips(DeskRelation.allCases, selected: [relation], label: { $0.title }) { relation = $0 }
        }
        .padding(.horizontal, 18).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A person on the number a relative can be linked to. The name is on screen only.
struct DeskFamilyAnchor: Hashable {
    let id: String
    let name: String
}

/// What the new relative is to the person they are linked to (`family_of.relation`).
enum DeskRelation: CaseIterable, Hashable {
    case guardian, child, spouse, parent, sibling, other

    var wire: String {
        switch self {
        case .guardian: "guardian"
        case .child: "child"
        case .spouse: "spouse"
        case .parent: "parent"
        case .sibling: "sibling"
        case .other: "other"
        }
    }

    var title: String { Self.title(wire: wire) }

    /// The word for a relation the server sent; an unknown one reads as Other.
    static func title(wire: String) -> String {
        switch wire {
        case "guardian": dv("d9.rel.guardian")
        case "child": dv("d9.rel.child")
        case "spouse": dv("d9.rel.spouse")
        case "parent": dv("d9.rel.parent")
        case "sibling": dv("d9.rel.sibling")
        default: dv("d9.rel.other")
        }
    }
}

/// The family section of the desk flow: a patient's relatives, and removing a link.
struct DeskFamilySheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let target: DeskPayTarget

    var body: some View {
        ScreenHost(make: { graph.family(clinic: clinic, patientId: target.patientId, screen: $0) }, state: { $0.state }) { holder, state in
            DeskFamilyList(holder: holder, state: state, patientId: target.patientId, name: target.name)
        }
        .skSheet()
    }
}

private struct DeskFamilyList: View {
    let holder: FamilyStateHolder
    let state: FamilyState
    let patientId: String
    let name: String
    @Environment(\.skTheme) private var theme
    @State private var linking = false

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                SkSheetHeader(dv("d9.family.section"), subtitle: dvf("d9.family.of", name))
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity)
                case .notAllowed:
                    Text(dv("d9.lookup.not_allowed.message")).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
                case .failed(let failed):
                    Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                    SkPillButton(String(localized: "try_again"), variant: .tonal) { holder.refresh() }
                case .loaded(let loaded):
                    if let error = loaded.actionError { Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                    if loaded.items.isEmpty { Text(dv("d9.family.none")).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color) }
                    ForEach(loaded.items, id: \.linkId) { person in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(person.name).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                                Text("\(DeskRelation.title(wire: person.relation)) · \(person.number)").v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                            }
                            Spacer(minLength: 0)
                            if loaded.canEdit {
                                SkPillButton(dv("d9.family.remove"), variant: .ghost) { holder.remove(linkId: person.linkId) }
                                    .accessibilityLabel(dvf("d9.family.remove.a11y", person.name))
                            }
                        }
                        .padding(12).background(r.card.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    if loaded.canEdit {
                        if linking {
                            DeskLinkExisting(holder: holder, patientId: patientId, linkedIds: Set(loaded.items.map(\.patientId))) { linking = false }
                        } else {
                            SkPillButton(dv("d9.family.link"), variant: .tonal, wide: true) { linking = true }
                        }
                    }
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
    }
}

/// "Link existing patient": search by number, pick the patient and the relation, then link.
private struct DeskLinkExisting: View {
    let holder: FamilyStateHolder
    let patientId: String
    let linkedIds: Set<String>
    let onDone: () -> Void
    @State private var query = ""
    @State private var search: LinkSearch = LinkSearchIdle.shared
    @State private var picked: LinkCandidate?
    @State private var relation: DeskRelation?
    @State private var showProblems = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 10) {
            SkField(dv("d9.family.link.field"), text: Binding(get: { query }, set: { query = $0; picked = nil; holder.searchCandidates(query: $0) }))
            switch onEnum(of: search) {
            case .idle: EmptyView()
            case .searching: SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity)
            case .failed(let failed): Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
            case .found(let found):
                if found.items.isEmpty { Text(dv("d9.family.link.none")).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color) }
                ForEach(found.items, id: \.patientId) { item in
                    Button { picked = item } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                                Text(item.number).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                            }
                            Spacer(minLength: 0)
                            if picked?.patientId == item.patientId { V7Icon(name: "check", size: 18, tint: r.primary.color) }
                        }
                        .padding(12).frame(minHeight: SkSpacing.minTouchTarget)
                        .background(r.card.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            V7Label(text: dv("d9.family.link.relation"))
            SkChoiceChips(DeskRelation.allCases, selected: relation.map { [$0] } ?? [], label: { $0.title }) { relation = $0 }
            if showProblems {
                ForEach(DeskFamilyLink.problems(patientId: patientId, pickedId: picked?.patientId, relation: relation, linkedIds: linkedIds), id: \.self) {
                    Text(DeskFamilyLink.message($0)).v7Text(12, .semibold).foregroundStyle(r.error.color)
                }
            }
            SkPillButton(dv("d9.family.link.submit"), wide: true) { submit() }
        }
        .task { for await next in holder.search { search = next } }
    }

    private func submit() {
        showProblems = true
        guard DeskFamilyLink.problems(patientId: patientId, pickedId: picked?.patientId, relation: relation, linkedIds: linkedIds).isEmpty,
              let picked, let relation else { return }
        holder.add(relatedPatientId: picked.patientId, relation: relation.wire, primaryContact: false)
        holder.clearSearch()
        onDone()
    }
}
