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
    let onOpenSchedule: () -> Void
    let onAddExpense: (() -> Void)?
    @State private var qr = false
    @State private var bell = false
    @State private var avatars = false
    @State private var avatarRevision = 0
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                content
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable { await refresh() }
        .toolbar { toolbar }
        #if DEBUG && AARO_ENV_Local
        .onAppear {
            qr = DevLaunch.sheet == "qr"
            bell = DevLaunch.sheet == "bell"
        }
        #endif
        .sheet(isPresented: $qr) {
            ClinicQRSheet(url: TodayV7.bookingURL(origin: clinic.api.origin), clinicName: clinic.session.clinic.name)
        }
        .sheet(isPresented: $bell) { NotificationsSheet(holder: notifications, state: notificationsState) }
        .sheet(isPresented: $avatars) {
            AvatarPicker(graph: graph) { avatarRevision += 1 }.presentationDetents([.medium, .large])
        }
    }

    private var money: Bool { if case .moneyOnly = onEnum(of: state) { true } else { false } }

    private var loaded: TodayStateLoaded? { if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil } }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if !money {
                Button { qr = true } label: {
                    Label { Text("t7.qr.title", tableName: "TodayV7") } icon: { V7Icon.image("qr") }
                }
            }
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
                graph: graph, clinic: clinic, state: loaded, onOpenPatient: onOpenPatient,
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
    let state: TodayStateLoaded
    let onOpenPatient: (String) -> Void
    let onOpenSchedule: () -> Void
    let onAddExpense: (() -> Void)?
    let onEditAvatar: () -> Void
    @Environment(\.skTheme) private var theme

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
            TodayStats(counts: view.counts).padding(.top, 10)
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
                    onAction: onOpenSchedule
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
    }

    private func pending(_ me: MeView) -> [ScheduleItem] {
        me.mine.filter { ![.completed, .noShow, .cancelled].contains($0.status) }.prefix(3).map { $0 }
    }

    private func model(_ me: MeView, waiting: Int) -> MeCardModel {
        let chips = TodayV7.meChips(
            isDoctor: me.practitionerId != nil, remaining: Int(me.remaining),
            treatments: me.treatments.map { ($0.name, Int($0.count)) }, waiting: waiting, onLeave: me.onLeave
        )
        var progress: MeCardModel.Progress?
        if let day = TodayV7.dayProgress(total: me.mine.count, remaining: Int(me.remaining)) {
            let ends = me.shifts.last.map { ClinicFormat.time(minuteOfDay: $0.ends.minuteOfDay) }
            let value = ends.map { String(format: String(localized: "t7.me.done_until", table: "TodayV7"), day.done, day.total, $0) }
                ?? String(format: String(localized: "t7.me.done", table: "TodayV7"), day.done, day.total)
            progress = .init(label: String(localized: "t7.me.your_day", table: "TodayV7"), value: value, fraction: day.fraction)
        }
        return MeCardModel(role: clinic.roleName, name: me.name, chips: chips, progress: progress)
    }
}
