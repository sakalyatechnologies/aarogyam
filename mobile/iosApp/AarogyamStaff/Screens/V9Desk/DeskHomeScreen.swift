import AarogyamShared
import SakalyaUI
import SwiftUI

/// v10 Desk home (A1 to A3): the availability strip, a mobile field that has focus on appear and searches
/// by itself at ten digits, profile chips, "Check in · Dr X", and the waiting-room board under it.
struct DeskHomeScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    /// "New patient": called with the typed number. Intake (T8) fills this in; the default opens the walk-in sheet.
    var onNewPatient: ((String) -> Void)?
    var onOpenPatient: (String) -> Void = { _ in }
    @State private var feed: DeskV10Feed
    @State private var lookup: ScreenModel<DeskLookupStateHolder, DeskLookupState>?
    @State private var board: ScreenModel<DeskBoardStateHolder, DeskBoardState>?
    @State private var typed = ""
    @State private var selected: String?
    @State private var chosenDoctor: String?
    @State private var tokenDone: Int?
    @State private var failed = false
    @State private var checkingIn = false
    @State private var paying: DeskPayTarget?
    @State private var walkIn: DeskHomeWalkIn?
    @FocusState private var focused: Bool
    @Environment(\.skTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    init(graph: AppGraph, clinic: ClinicContext, onNewPatient: ((String) -> Void)? = nil, onOpenPatient: @escaping (String) -> Void = { _ in }) {
        self.graph = graph
        self.clinic = clinic
        self.onNewPatient = onNewPatient
        self.onOpenPatient = onOpenPatient
        _feed = State(initialValue: DeskV10Feed(clinic: clinic))
    }

    /// Collecting needs the bill keys, or `payments.collect` (assistant, front desk, doctor) through collect-summary.
    private var canCollect: Bool { DeskV10Collect.canCollect(clinic.permissions) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                AvailabilityStripView(strip: feed.strip)
                if let tokenDone { doneCard(tokenDone) } else { finder }
                if let board {
                    DeskBoardScreen(holder: board.holder, state: board.value, clinic: clinic, onOpenPatient: onOpenPatient,
                                    onCollect: { paying = $0 }, feed: feed, embedded: true)
                }
            }
            .padding(.horizontal, SkSpacing.l).padding(.top, SkSpacing.s).padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .refreshable { board?.holder.refresh(); await feed.refresh() }
        // Polls only in front; coming back restarts it, which refreshes at once.
        .task(id: scenePhase) { if scenePhase == .active { await feed.run() } }
        .onAppear {
            if lookup == nil { lookup = ScreenModel(make: { graph.deskLookup(clinic: clinic, screen: $0) }, state: { $0.state }) }
            if board == nil { board = ScreenModel(make: { graph.deskBoard(clinic: clinic, screen: $0) }, state: { $0.state }) }
            focused = true
        }
        // A payment that settles the bill moves the visit to done on the server, so reload at once
        // rather than leaving the card up until the next 20-second poll.
        .sheet(item: $paying, onDismiss: { board?.holder.refresh(); Task { await feed.refresh() } }) {
            DeskPaymentSheet(graph: graph, clinic: clinic, target: $0, refreshTick: feed.version)
        }
        .sheet(item: $walkIn) { mode in
            DeskSheet(graph: graph, clinic: clinic, start: mode.mode)
        }
    }

    // MARK: finder

    @ViewBuilder private var finder: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(dx("dx.home.number")).v7Text(13, .semibold).foregroundStyle(theme.roles.onSurfaceVariant.color)
            TextField("98765 43210", text: Binding(get: { typed }, set: { change($0) }))
                .keyboardType(.numberPad).textContentType(.telephoneNumber).focused($focused)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .padding(.horizontal, 14).frame(minHeight: SkSpacing.minTouchTarget + 8)
                .background(theme.roles.card.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                // In light mode the card matches the page, so the outline is what shows the box.
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(focused ? theme.roles.primary.color : theme.roles.outline.color, lineWidth: focused ? 2 : 1)
                }
                .accessibilityLabel(dx("dx.home.number.a11y"))
                .accessibilityHint(dx("dx.home.number.hint"))
        }
        if let lookup { results(lookup.value, lookup.holder) }
        if failed { Text(dx("dx.home.checkin.failed")).v7Text(12.5, .semibold).foregroundStyle(theme.roles.error.color) }
    }

    @ViewBuilder private func results(_ state: DeskLookupState, _ holder: DeskLookupStateHolder) -> some View {
        switch onEnum(of: state) {
        case .notAllowed:
            SkEmptyState(dv("d9.lookup.not_allowed.title"), message: dv("d9.lookup.not_allowed.message"))
        case .idle:
            Text(dx("dx.home.number.hint")).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .looking:
            HStack(spacing: 8) { ProgressView(); Text(dv("d9.lookup.looking")).v7Text(12.5) }.accessibilityElement(children: .combine)
        case .failed(let failure):
            VStack(alignment: .leading, spacing: 8) {
                Text(failure.error.message).v7Text(12.5, .semibold).foregroundStyle(theme.roles.error.color)
                SkPillButton(String(localized: "try_again"), variant: .tonal) { holder.search(typed: ""); holder.search(typed: DeskPhone.digits(typed)) }
            }
        case .noMatch(let none):
            VStack(alignment: .leading, spacing: 10) {
                Text(dv("d9.lookup.none.title")).v7Text(15, .bold).foregroundStyle(theme.roles.onSurface.color)
                SkPillButton(dx("dx.home.new"), variant: .warm, wide: true) { newPatient(none.phone) }
                    .accessibilityLabel(dx("dx.home.new"))
            }
        case .matches(let found):
            matches(found, holder)
        case .checkedIn(let done):
            Color.clear.frame(height: 0).onAppear { tokenDone = Int(done.tokenNumber) }
        }
    }

    @ViewBuilder private func matches(_ found: DeskLookupStateMatches, _ holder: DeskLookupStateHolder) -> some View {
        let profiles = found.profiles
        let current = profiles.first { $0.id == selected } ?? profiles.first { !$0.checkedInToday } ?? profiles.first
        FlowLayout(spacing: 8) {
            ForEach(profiles, id: \.id) { profile in
                let on = profile.id == current?.id
                Button { selected = profile.id; chosenDoctor = nil } label: {
                    Text(profile.name.isEmpty ? profile.initials : profile.name).v7Text(14, .semibold)
                        .foregroundStyle(on ? theme.roles.onPrimary.color : theme.roles.onPrimaryContainer.color)
                        .padding(.horizontal, 14).frame(minHeight: SkSpacing.minTouchTarget)
                        .background((on ? theme.roles.primary : theme.roles.primaryContainer).color, in: Capsule())
                }
                .buttonStyle(.skPressable)
                .accessibilityLabel(profile.name.isEmpty ? profile.initials : profile.name)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        if let current {
            let doctor = DeskV10Doctors.pick(doctors: feed.doctors, lastDoctorId: feed.lastDoctor[current.id]?.id, chosenId: chosenDoctor)
            if !current.checkedInToday, feed.doctors.count > 1 { doctorChips(doctor) }
            DeskProfileRow(
                profile: current, ofName: profiles.first { $0.id == current.familyOf }?.name,
                canCollect: canCollect, canFamily: false,
                onCheckIn: { checkIn(current, doctor) }, onCollect: { paying = DeskPayTarget(patientId: current.id, name: current.name) },
                onFamily: {}, checkInTitle: DeskV10Doctors.checkInTitle(doctor)
            )
            .disabled(checkingIn)
        }
        SkPillButton(dx("dx.home.new"), variant: .warm, wide: true) { newPatient(found.phone) }
            .accessibilityLabel(dx("dx.home.new"))
    }

    private func doctorChips(_ current: DeskV10Doctor?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(dx("dx.home.doctor")).v7Text(12, .semibold).foregroundStyle(theme.roles.onSurfaceVariant.color)
            SkChoiceChips(feed.doctors, selected: current.map { [$0] } ?? [], label: { DeskV10Doctors.label($0.name) }) { chosenDoctor = $0.id }
        }
    }

    private func doneCard(_ token: Int) -> some View {
        VStack(spacing: 12) {
            SkCheckDraw()
            SkSheetHeader(dxf("dx.home.done", token), subtitle: dx("dx.home.done.message")).multilineTextAlignment(.center)
            SkPillButton(dx("dx.home.next"), wide: true) { reset() }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: actions

    private func change(_ text: String) {
        let formatted = DeskPhone.format(text)
        typed = formatted
        selected = nil
        chosenDoctor = nil
        failed = false
        lookup?.holder.search(typed: DeskPhone.digits(formatted))
    }

    private func reset() {
        tokenDone = nil
        change("")
        focused = true
    }

    private func checkIn(_ profile: DeskProfile, _ doctor: DeskV10Doctor?) {
        guard !checkingIn else { return }
        checkingIn = true
        failed = false
        Task {
            if let token = await feed.checkIn(patientId: profile.id, doctorId: doctor?.id) {
                tokenDone = token
                board?.holder.refresh()
            } else {
                failed = true
            }
            checkingIn = false
        }
    }

    private func newPatient(_ phone: String) {
        if let onNewPatient { onNewPatient(phone) } else { walkIn = DeskHomeWalkIn(phone: phone) }
    }
}

/// The existing walk-in sheet, opened on its form with the number filled in.
struct DeskHomeWalkIn: Identifiable {
    let phone: String
    var id: String { phone }
    var mode: DeskSheet.Mode { .form(phone: phone, family: nil) }
}

/// Doctors free / with a patient / away, chairs free / busy, as chips that wrap.
struct AvailabilityStripView: View {
    let strip: DeskV10Feed.Strip
    @Environment(\.skTheme) private var theme

    var body: some View {
        switch strip {
        case .hidden: EmptyView()
        case .loading:
            Text(dx("dx.strip.loading")).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .unavailable:
            Text(dx("dx.strip.unavailable")).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .loaded(let loaded):
            let chips = DeskV10Strip.chips(
                doctorsFree: Int(loaded.freeDoctors), withPatient: loaded.doctors.filter { $0.availability == .withPatient }.count,
                away: loaded.doctors.filter { $0.availability == .away }.count, hasDoctors: !loaded.doctors.isEmpty,
                chairsFree: Int(loaded.freeChairs), chairsBusy: loaded.chairs.count - Int(loaded.freeChairs), hasChairs: !loaded.chairs.isEmpty)
            FlowLayout(spacing: 6) {
                ForEach(Array(chips.enumerated()), id: \.offset) { _, chip in
                    SkChip(chip.text, tone: chip.tone.skTone).accessibilityLabel(chip.text)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(dx("dx.strip.a11y"))
        }
    }
}

private extension DeskV10StripChip.Tone {
    var skTone: SkTone {
        switch self {
        case .success: .success
        case .info: .info
        case .neutral: .neutral
        case .warning: .warning
        }
    }
}
