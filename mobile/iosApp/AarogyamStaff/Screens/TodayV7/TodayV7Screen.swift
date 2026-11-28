import AarogyamShared
import SakalyaUI
import SwiftUI

/// Today in the v7 design: me card and My schedule, the day's numbers, who is next, the money,
/// the schedule and what needs attention; finance-only roles get the money page instead.
struct TodayV7Screen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let holder: TodayStateHolder
    let state: TodayState
    let notifications: NotificationsStateHolder
    let notificationsState: ListState
    let onOpenPatient: (String) -> Void
    /// Opens the Schedule tab on a segment: 0 Queue, 1 Day.
    let onOpenSchedule: (Int) -> Void
    let onAddExpense: (() -> Void)?
    @State private var bell = false
    @State private var avatars = false
    @State private var avatarRevision = 0
    @Environment(\.skTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                content
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollIndicators(.hidden)
        .skSoftScrollEdge()
        .refreshable { await refresh() }
        .task(id: clinic.slug) {
            if await AvatarChoice.pull(graph: graph, clinic: clinic) { avatarRevision += 1 }
        }
        .task(id: scenePhase) {
            // Reloads every 20 s (shared PollingUpdates) while Today is on screen and the app is active.
            // The task is cancelled when the screen goes away or the app leaves the foreground.
            guard scenePhase == .active else { return }
            for await _ in PollingUpdates(intervalMillis: PollingUpdates.companion.POLL_MILLIS).changes() {
                holder.refresh()
                notifications.refresh()
            }
        }
        .toolbar { toolbar }
        #if DEBUG && AARO_ENV_Local
        .onAppear {
            bell = DevLaunch.sheet == "bell"
        }
        #endif
        .sheet(isPresented: $bell) {
            NotificationsSheet(holder: notifications, state: notificationsState) { id in
                bell = false
                onOpenPatient(id)
            }
        }
        .sheet(isPresented: $avatars) {
            AvatarPicker(graph: graph, clinic: clinic) { avatarRevision += 1 }.presentationDetents([.medium, .large])
        }
    }

    private var money: Bool { if case .moneyOnly = onEnum(of: state) { true } else { false } }

    private var loaded: TodayStateLoaded? { if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil } }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { bell = true } label: {
                Label { Text("t7.notifications", tableName: "TodayV7") } icon: { V7Icon.image("bell") }
            }
            .overlay(alignment: .topTrailing) { if unread { SkBadgeDot().offset(x: 2, y: -2).allowsHitTesting(false) } }
        }
    }

    private var unread: Bool {
        if case .loaded(let list) = onEnum(of: notificationsState) { list.items.compactMap { $0 as? AlertRow }.contains { !$0.read } } else { false }
    }

    private var header: some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 2) {
            if let view = loaded?.view {
                Text("\(TodayV7.longDay(iso: view.date.isoText)) · \(view.clinicName)")
                    .font(.system(size: 12, weight: .bold)).tracking(0.5).foregroundStyle(r.primary.color)
            }
            Text(money ? "t7.money.today" : "today.title", tableName: money ? "TodayV7" : nil)
                .skTextStyle(SkTypeScale.largeTitle).foregroundStyle(r.onSurface.color).accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, SkSpacing.l).padding(.top, SkSpacing.s).padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "today.not_allowed.title"), message: String(localized: "today.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "today.title"), message: failed.error.message,
                actionTitle: String(localized: "try_again"), action: holder.refresh
            )
        case .moneyOnly(let finance):
            FinanceToday(graph: graph, clinic: clinic, money: finance.money, error: finance.error?.message, onAddExpense: onAddExpense) { avatars = true }
                .id(avatarRevision)
        case .loaded(let loaded):
            DayContent(
                graph: graph, clinic: clinic, cycles: holder.cycles, state: loaded, onOpenPatient: onOpenPatient,
                onOpenSchedule: onOpenSchedule, onAddExpense: onAddExpense
            ) { avatars = true }
            .id(avatarRevision)
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        notifications.refresh()
        for await next in holder.state {
            if let now = next as? TodayStateLoaded, now.refreshing { continue }
            if let now = next as? TodayStateMoneyOnly, now.refreshing { continue }
            break
        }
    }
}

private struct DayContent: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let cycles: CycleLogHolder
    let state: TodayStateLoaded
    let onOpenPatient: (String) -> Void
    /// Opens the Schedule tab on a segment: 0 Queue, 1 Day.
    let onOpenSchedule: (Int) -> Void
    let onAddExpense: (() -> Void)?
    let onEditAvatar: () -> Void
    @State private var logCycle = false
    @Environment(\.skTheme) private var theme
    private let queue = WaitingForMe.shared

    var body: some View {
        let view = state.view
        VStack(alignment: .leading, spacing: 0) {
            if let error = state.error {
                Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color)
            }
            if let me = view.me {
                MePager(
                    graph: graph, model: model(me, waiting: Int(view.counts.waiting)),
                    schedule: me.practitionerId == nil ? nil : MySchedule(iso: view.date.isoText, rows: pending(me)),
                    onEditAvatar: onEditAvatar
                ) { onOpenPatient($0.patientId) }
                .padding(.top, 8)
            }
            TodayStats(counts: view.counts) { onOpenSchedule(0) }.padding(.top, 10)
            if view.counts.onlineToConfirm > 0, clinic.permissions.contains("appointments.write") {
                OnlineBookingsCard(count: Int(view.counts.onlineToConfirm)) { onOpenSchedule(3) }.padding(.top, 8)
            }
            if let hero = view.hero, let kind = view.heroKind {
                TodayHero(
                    kind: kind, item: hero, progress: Double(view.progress), done: Int(view.counts.done),
                    total: Int(view.counts.visits), onOpen: { onOpenPatient(hero.patientId) }
                )
                .padding(.top, 8)
            }
            if let money = view.money { MoneyCards(money: money, onAddExpense: onAddExpense).padding(.top, 10) }
            let next = TodayV7.upNext(view.schedule, excluding: view.hero)
            if !next.isEmpty {
                TodaySectionHeader(
                    title: String(localized: "t7.up_next", table: "TodayV7"),
                    action: String(format: String(localized: "t7.up_next.all", table: "TodayV7"), Int(view.counts.visits)),
                    onAction: { onOpenSchedule(1) }
                )
                .padding(.horizontal, SkSpacing.l)
                UpNextCarousel(items: next) { onOpenPatient($0.patientId) }.padding(.horizontal, -SkSpacing.l)
            }
            TodaySectionHeader(title: String(localized: "today.schedule"))
            if view.schedule.isEmpty {
                SkEmptyState(String(localized: "today.schedule.empty.title"), message: String(localized: "today.schedule.empty.message"))
            } else {
                TodaySchedule(items: view.schedule) { onOpenPatient($0.patientId) }
            }
            if !view.attention.isEmpty {
                TodaySectionHeader(title: String(localized: "t7.needs_attention", table: "TodayV7"))
                AttentionList(items: view.attention) { if !$0.patientId.isEmpty { onOpenPatient($0.patientId) } }
            }
        }
        .padding(.horizontal, SkSpacing.l)
        .sheet(isPresented: $logCycle) { CycleSheet(holder: cycles).presentationDetents([.medium, .large]) }
    }

    private func pending(_ me: MeView) -> [ScheduleItem] {
        me.mine.filter { ![.completed, .noShow, .cancelled].contains($0.status) }.prefix(3).map { $0 }
    }

    private func model(_ me: MeView, waiting: Int) -> MeCardModel {
        var chips = TodayV7.meChips(
            isDoctor: me.practitionerId != nil, remaining: Int(me.remaining) + (me.practitionerId != nil ? queue.count : 0),
            treatments: me.treatments.map { ($0.name, Int($0.count)) }, waiting: waiting, onLeave: me.onLeave
        )
        if me.practitionerId != nil, let stats = me.stats {
            chips.append(String(localized: "t7.me.stat_seen \(Int(stats.patientsSeen))", table: "TodayV7"))
            chips.append(String(localized: "t7.me.stat_procedures \(Int(stats.proceduresDone))", table: "TodayV7"))
            chips.append(String(localized: "t7.me.stat_rx \(Int(stats.prescriptionsIssued))", table: "TodayV7"))
            if let paise = stats.collectedPaise {
                chips.append(String(format: String(localized: "t7.me.stat_collected", table: "TodayV7"), ClinicFormat.rupees(paise: paise.int64Value)))
            }
        }
        var progress: MeCardModel.Progress?
        if let day = TodayV7.dayProgress(total: me.mine.count, remaining: Int(me.remaining)) {
            let ends = (me.dayEndsAt ?? me.shifts.last?.ends).map { ClinicFormat.time(minuteOfDay: $0.minuteOfDay) }
            let value = ends.map { String(format: String(localized: "t7.me.done_until", table: "TodayV7"), day.done, day.total, $0) }
                ?? String(format: String(localized: "t7.me.done", table: "TodayV7"), day.done, day.total)
            progress = .init(label: String(localized: "t7.me.your_day", table: "TodayV7"), value: value, fraction: day.fraction)
        }
        var target: MeCardModel.Progress?
        if let goal = me.monthTargetPaise?.int64Value, goal > 0, let got = me.monthCollectedPaise?.int64Value {
            target = .init(
                label: String(localized: "t7.me.target", table: "TodayV7"),
                value: String(format: String(localized: "t7.me.target_value", table: "TodayV7"), ClinicFormat.rupees(paise: got), ClinicFormat.rupees(paise: goal)),
                fraction: min(1, Double(got) / Double(goal))
            )
        }
        return MeCardModel(
            role: clinic.roleName, name: me.name, chips: chips, progress: progress, monthTarget: target,
            cycles: Int(me.sterilisationToday), onLogCycle: cycles.allowed ? { logCycle = true } : nil
        )
    }
}
