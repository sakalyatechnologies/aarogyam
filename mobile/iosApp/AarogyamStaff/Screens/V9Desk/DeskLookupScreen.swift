import AarogyamShared
import SakalyaUI
import SwiftUI

/// The front desk's lookup (Clear Glass): a big mobile field focused on open, the profiles on the
/// number in one grouped card with an inline Check in, and Add family member and New patient as
/// rows under them. The number is on screen only; nothing here logs it.
struct DeskLookupScreen: View {
    let holder: DeskLookupStateHolder
    let state: DeskLookupState
    let graph: AppGraph
    let clinic: ClinicContext
    let onNewPatient: (String) -> Void
    let onFamily: (String, [DeskFamilyAnchor]) -> Void
    let onCollect: (DeskPayTarget) -> Void
    /// Opens the patient page for this id.
    var onOpen: (String) -> Void = { _ in }
    /// Books an appointment for this patient instead of checking in now.
    var onBook: (DeskPayTarget) -> Void = { _ in }
    @State private var typed = DeskLaunch.firstPhone
    @State private var net = V9Connectivity()
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    private var canBook: Bool { clinic.permissions.contains("appointments.write") }
    private var canCollect: Bool { clinic.permissions.contains("billing.write") && clinic.permissions.contains("billing.read") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if case .notAllowed = onEnum(of: state) {
                    SkEmptyState(dv("d9.lookup.not_allowed.title"), message: dv("d9.lookup.not_allowed.message"))
                } else if case .checkedIn(let done) = onEnum(of: state) {
                    checkedIn(done)
                } else {
                    if !net.online { offlineBanner.padding(.top, SkSpacing.s) }
                    GroupedHeader(dv("d9.lookup.mobile"))
                    DeskNumberField(label: dv("d9.lookup.mobile"), text: Binding(get: { typed }, set: { change($0) }), focused: $focused)
                    results
                }
            }
            .padding(.horizontal, SkSpacing.l).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            if !typed.isEmpty { change(typed) }
            focused = true
        }
    }

    private func change(_ text: String) {
        let formatted = DeskPhone.format(text)
        typed = formatted
        holder.search(typed: DeskPhone.query(formatted))
    }

    private var offlineBanner: some View {
        Text(dv("d9.lookup.offline")).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.onErrorContainer.color)
            .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.roles.errorContainer.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder private var results: some View {
        let r = theme.roles
        switch onEnum(of: state) {
        case .idle:
            Text(dv("d9.lookup.hint")).font(.footnote).foregroundStyle(r.onSurfaceVariant.color).padding(.horizontal, 4).padding(.top, 8)
        case .looking:
            HStack(spacing: 8) { ProgressView(); Text(dv("d9.lookup.looking")).font(.footnote) }
                .foregroundStyle(r.onSurfaceVariant.color).padding(.horizontal, 4).padding(.top, 12)
                .accessibilityElement(children: .combine)
        case .failed(let failed):
            VStack(alignment: .leading, spacing: 8) {
                Text(failed.error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                Button(String(localized: "try_again")) {
                    holder.search(typed: "")
                    holder.search(typed: DeskPhone.query(typed))
                }
                .skGlassButton()
            }
            .padding(.top, 12)
        case .noMatch(let none):
            GroupedHeader(dv("d9.lookup.none.title"))
            GroupedCard {
                Text(dv("d9.lookup.none.message")).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color)
                    .padding(.horizontal, GroupedSizes.rowPaddingH).padding(.top, 12).padding(.bottom, 4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                DeskActionRow(title: dv("d9.lookup.new"), systemImage: "person.badge.plus") { onNewPatient(DeskPhone.newPatientPhone(none.phone)) }
            }
        case .matches(let found):
            GroupedHeader(dvf("d9.lookup.profiles", found.profiles.count))
            GroupedCard {
                ForEach(found.profiles, id: \.id) { profile in
                    DeskMatchRow(
                        profile: profile, ofName: found.profiles.first { $0.id == profile.familyOf }?.name,
                        canCollect: canCollect, canBook: canBook,
                        onCheckIn: { holder.checkIn(patientId: profile.id) },
                        onCollect: { onCollect(DeskPayTarget(patientId: profile.id, name: profile.name)) },
                        onOpen: { onOpen(profile.id) },
                        onBook: { onBook(DeskPayTarget(patientId: profile.id, name: profile.name)) }
                    )
                    GroupedDivider()
                }
                if ServerCaps.shared.family, !found.partial {
                    DeskActionRow(title: dv("d9.lookup.family"), systemImage: "person.2") {
                        onFamily(found.phone, found.profiles.filter { $0.familyOf == nil }.map { DeskFamilyAnchor(id: $0.id, name: $0.name) })
                    }
                    GroupedDivider()
                }
                DeskActionRow(title: dv("d9.lookup.new"), systemImage: "person.badge.plus") { onNewPatient(DeskPhone.newPatientPhone(found.phone)) }
            }
        case .notAllowed, .checkedIn:
            EmptyView()
        }
    }

    private func checkedIn(_ done: DeskLookupStateCheckedIn) -> some View {
        VStack(spacing: 12) {
            SkCheckDraw()
            SkSheetHeader(dvf("d9.lookup.done.title", Int(done.tokenNumber)), subtitle: dv("d9.lookup.done.message"))
                .multilineTextAlignment(.center)
            GlassWideButton(title: dv("d9.lookup.another"), prominent: false) { change("") }
            GlassWideButton(title: dv("d9.done")) { dismiss() }
        }
        .padding(.top, SkSpacing.l)
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
