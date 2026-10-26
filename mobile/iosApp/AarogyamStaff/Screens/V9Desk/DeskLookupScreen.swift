import AarogyamShared
import SakalyaUI
import SwiftUI

/// The front desk's lookup: a mobile field with live results, a picker of the profiles on the
/// number, and the next actions. The number is on screen only; nothing here logs it.
struct DeskLookupScreen: View {
    let holder: DeskLookupStateHolder
    let state: DeskLookupState
    let graph: AppGraph
    let clinic: ClinicContext
    let onNewPatient: (String) -> Void
    let onFamily: (String, [DeskFamilyAnchor]) -> Void
    let onCollect: (DeskPayTarget) -> Void
    @State private var typed = DeskLaunch.firstPhone
    @State private var relatives: DeskPayTarget?
    @State private var net = V9Connectivity()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    private var canCollect: Bool { clinic.permissions.contains("billing.write") && clinic.permissions.contains("billing.read") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(dv("d9.lookup.not_allowed.title"), message: dv("d9.lookup.not_allowed.message"))
                } else if case .checkedIn(let done) = onEnum(of: state) {
                    checkedIn(done)
                } else {
                    SkSheetHeader(dv("d9.lookup.title"), subtitle: dv("d9.lookup.subtitle"))
                    if !net.online { offlineBanner }
                    SkField(
                        dv("d9.lookup.mobile"),
                        text: Binding(get: { typed }, set: { change($0) }),
                        placeholder: "98765 43210", contentType: .telephoneNumber, keyboard: .numberPad
                    )
                    results
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        .onAppear { if !typed.isEmpty { change(typed) } }
        .sheet(item: $relatives) { DeskFamilySheet(graph: graph, clinic: clinic, target: $0) }
    }

    private func change(_ text: String) {
        let formatted = DeskPhone.format(text)
        typed = formatted
        holder.search(typed: DeskPhone.digits(formatted))
    }

    private var offlineBanner: some View {
        Text(dv("d9.lookup.offline")).v7Text(12.5, .semibold).foregroundStyle(theme.roles.onErrorContainer.color)
            .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.errorContainer.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private var results: some View {
        switch onEnum(of: state) {
        case .idle:
            Text(dv("d9.lookup.hint")).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .looking:
            HStack(spacing: 8) { ProgressView(); Text(dv("d9.lookup.looking")).v7Text(12.5) }
                .accessibilityElement(children: .combine)
        case .failed(let failed):
            VStack(alignment: .leading, spacing: 8) {
                Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(theme.roles.error.color)
                SkPillButton(String(localized: "try_again"), variant: .tonal) {
                    holder.search(typed: "")
                    holder.search(typed: DeskPhone.digits(typed))
                }
            }
        case .noMatch(let none):
            VStack(alignment: .leading, spacing: 10) {
                Text(dv("d9.lookup.none.title")).v7Text(15, .bold).foregroundStyle(theme.roles.onSurface.color)
                Text(dv("d9.lookup.none.message")).v7Text(12.5).foregroundStyle(theme.roles.onSurfaceVariant.color)
                SkPillButton(dv("d9.lookup.new"), variant: .warm, wide: true) { onNewPatient(none.phone) }
            }
        case .matches(let found):
            V7Label(text: dvf("d9.lookup.profiles", found.profiles.count))
            VStack(spacing: 8) {
                ForEach(found.profiles, id: \.id) { profile in
                    DeskProfileRow(profile: profile, ofName: found.profiles.first { $0.id == profile.familyOf }?.name,
                                   canCollect: canCollect, canFamily: clinic.permissions.contains("patients.read") && ServerCaps.shared.family,
                                   onCheckIn: { holder.checkIn(patientId: profile.id) },
                                   onCollect: { onCollect(DeskPayTarget(patientId: profile.id, name: profile.name)) },
                                   onFamily: { relatives = DeskPayTarget(patientId: profile.id, name: profile.name) })
                }
            }
            if ServerCaps.shared.family {
                SkPillButton(dv("d9.lookup.family"), variant: .tonal, wide: true) {
                    onFamily(found.phone, found.profiles.filter { $0.familyOf == nil }.map { DeskFamilyAnchor(id: $0.id, name: $0.name) })
                }
            }
            SkPillButton(dv("d9.lookup.new"), variant: .warm, wide: true) { onNewPatient(found.phone) }
        case .notAllowed, .checkedIn:
            EmptyView()
        }
    }

    private func checkedIn(_ done: DeskLookupStateCheckedIn) -> some View {
        VStack(spacing: 12) {
            SkCheckDraw()
            SkSheetHeader(dvf("d9.lookup.done.title", Int(done.tokenNumber)), subtitle: dv("d9.lookup.done.message"))
                .multilineTextAlignment(.center)
            SkPillButton(dv("d9.lookup.another"), variant: .tonal, wide: true) { change("") }
            SkPillButton(dv("d9.done"), wide: true) { dismiss() }
        }
    }
}

/// One profile on the number: initials avatar, name, age and sex, last visit, a "checked in" badge
/// and the actions that fit.
struct DeskProfileRow: View {
    let profile: DeskProfile
    /// The person this relative is linked to, when the profile is a relative.
    let ofName: String?
    let canCollect: Bool
    let canFamily: Bool
    let onCheckIn: () -> Void
    let onCollect: () -> Void
    let onFamily: () -> Void
    /// v10: "Check in · Dr X"; nil keeps the plain label.
    var checkInTitle: String?
    private var name: String { profile.name.isEmpty ? profile.initials : profile.name }
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text(profile.initials).font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(profile.checkedInToday ? r.onPrimary.color : r.onPrimaryContainer.color)
                    .frame(width: 44, height: 44)
                    .background((profile.checkedInToday ? r.primary : r.primaryContainer).color, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                    Text(patientLine(number: profile.number, ageYears: profile.ageYears?.intValue, sex: profile.sex))
                        .v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                    if let relation = profile.relation, let ofName {
                        Text(dvf("d9.lookup.relation_of", DeskRelation.title(wire: relation), ofName)).v7Text(12, .semibold)
                            .foregroundStyle(r.primary.color)
                    }
                    Text(lastVisitText).v7Text(11.5).foregroundStyle(r.onSurfaceVariant.color)
                }
                Spacer(minLength: 0)
            }
            if profile.checkedInToday {
                HStack(spacing: 6) {
                    SkChip(dv("d9.lookup.checked_in"), tone: .success)
                    if let state = profile.state { SkChip(state.title, tone: .info) }
                }
            }
            FlowLayout(spacing: 8) {
                if !profile.checkedInToday {
                    SkPillButton(checkInTitle ?? dv("d9.lookup.check_in"), action: onCheckIn)
                        .accessibilityLabel(dvf("d9.lookup.check_in.a11y", name))
                }
                if canCollect { SkPillButton(dv("d9.lookup.collect"), variant: .tonal, action: onCollect) }
                if canFamily && profile.familyOf == nil { SkPillButton(dv("d9.family.section"), variant: .ghost, action: onFamily) }
            }
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var lastVisitText: String {
        guard let last = profile.lastVisit, last.count >= 10 else { return dv("d9.lookup.last_visit.none") }
        return dvf("d9.lookup.last_visit", ClinicFormat.day(iso: String(last.prefix(10))))
    }
}
