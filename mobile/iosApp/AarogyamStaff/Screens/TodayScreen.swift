import AarogyamShared
import SakalyaUI
import SwiftUI

/// Today at the clinic, as in the mock-up: large title, who is next, the day's numbers, the schedule.
struct TodayScreen: View {
    let holder: TodayStateHolder
    let state: TodayState
    let onSwitchClinic: () -> Void
    let onSignOut: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SkLargeTitleHeader(String(localized: "today.title"), subtitle: subtitle)
                content
            }
            .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { await refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button(String(localized: "today.switch_clinic"), systemImage: "building.2", action: onSwitchClinic)
                    // iOS keeps the per-app language in Settings (Aarogyam > Language).
                    Button(String(localized: "today.language"), systemImage: "globe") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    Button(String(localized: "sign_out"), systemImage: "rectangle.portrait.and.arrow.right", role: .destructive, action: onSignOut)
                } label: {
                    Image(systemName: "ellipsis.circle").accessibilityLabel(Text("today.more"))
                }
            }
        }
    }

    private var loaded: TodayStateLoaded? {
        if case .loaded(let loaded) = onEnum(of: state) { loaded } else { nil }
    }

    private var subtitle: String? {
        guard let view = loaded?.view else { return nil }
        return "\(ClinicFormat.day(iso: view.date.isoText)) · \(view.clinicName)"
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "today.not_allowed.title"), message: String(localized: "today.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "today.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            TodayContent(state: loaded)
        }
    }

    /// Reloads and returns once the answer (or a failure) is on screen.
    private func refresh() async {
        holder.refresh()
        for await next in holder.state {
            if let now = next as? TodayStateLoaded, now.refreshing { continue }
            break
        }
    }
}

private struct TodayContent: View {
    let state: TodayStateLoaded
    @Environment(\.skTheme) private var theme

    var body: some View {
        let view = state.view
        let p = theme.palette
        VStack(alignment: .leading, spacing: SkSpacing.ml) {
            if let error = state.error {
                Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.dangerText.color)
            }
            if let hero = view.hero {
                let kicker = view.heroKind == .now ? "today.hero.now" : "today.hero.next"
                SkHeroCard(
                    kicker: String(format: String(localized: String.LocalizationValue(kicker)), hero.startsText),
                    title: hero.patientName,
                    subtitle: [hero.reason, hero.room, hero.patientNumber].compactMap { $0 }.joined(separator: " · ")
                )
            }
            HStack(spacing: SkSpacing.m) {
                SkStatTile(value: "\(view.counts.visits)", label: String(localized: "today.stat.visits"))
                SkStatTile(value: "\(view.counts.waiting)", label: String(localized: "today.stat.waiting"))
                SkStatTile(value: "\(view.counts.done)", label: String(localized: "today.stat.done"))
            }
            if let money = view.money {
                HStack(spacing: SkSpacing.m) {
                    SkStatTile(value: ClinicFormat.rupees(paise: money.collectedPaise), label: String(localized: "today.stat.collected"))
                    SkStatTile(value: ClinicFormat.rupees(paise: money.pendingDuesPaise), label: String(localized: "today.stat.dues"))
                    SkStatTile(value: money.upiShareText, label: String(localized: "today.stat.upi"))
                }
            }
            Text("today.schedule").skTextStyle(SkTypeScale.label).foregroundStyle(p.textMuted.color)
                .textCase(.uppercase)
                .padding(.horizontal, SkSpacing.xs)
                .padding(.top, SkSpacing.s)
                .accessibilityAddTraits(.isHeader)
            schedule(view.schedule)
        }
        .padding(.horizontal, SkSpacing.l)
    }

    @ViewBuilder private func schedule(_ items: [ScheduleItem]) -> some View {
        if items.isEmpty {
            SkEmptyState(String(localized: "today.schedule.empty.title"), message: String(localized: "today.schedule.empty.message"))
        } else {
            SkCard(padding: SkSpacing.xs) {
                ForEach(Array(items.enumerated()), id: \.element.appointmentId) { index, item in
                    if index > 0 { SkDivider() }
                    SkListRow(item.patientName, subtitle: [item.startsText, item.reason].compactMap { $0 }.joined(separator: " · ")) {
                        SkAvatar(item.patientName, tone: item.status.tone)
                    } trailing: {
                        SkChip(item.status.label.uppercased(), tone: item.status.tone)
                    }
                }
            }
        }
    }
}
