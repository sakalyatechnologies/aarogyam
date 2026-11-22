import AarogyamShared
import SakalyaUI
import SwiftUI

/// Today's patients, waiting (warm) and done as three columns of one grouped card, with what is left under it.
struct TodayStats: View {
    let counts: TodayCountsView
    @Environment(\.skTheme) private var theme

    private var hint: String {
        let done = Int(counts.patientsDone?.int32Value ?? counts.done), toCome = Int(counts.toCome)
        let key: String.LocalizationValue = toCome == 1 ? "t7.stat.hint_one" : "t7.stat.hint_other"
        return String(format: String(localized: key, table: "TodayV7"), done, toCome)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            GroupedCard {
                HStack(spacing: 0) {
                    stat("\(counts.patients)", String(localized: "t7.stat.patients", table: "TodayV7"))
                    divider
                    stat("\(counts.waiting)", String(localized: "t7.stat.waiting", table: "TodayV7"), warm: true)
                    divider
                    stat("\(counts.done)", String(localized: "t7.stat.done", table: "TodayV7"))
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            Text(hint).font(.footnote).foregroundStyle(theme.roles.onSurfaceVariant.color).padding(.leading, 4)
        }
    }

    private var divider: some View {
        Rectangle().fill(theme.roles.outline.color.opacity(0.35)).frame(width: 0.5).accessibilityHidden(true)
    }

    private func stat(_ value: String, _ label: String, warm: Bool = false) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.weight(.heavy)).monospacedDigit().foregroundStyle((warm ? r.tertiary : r.onSurface).color)
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(r.onSurfaceVariant.color).lineLimit(2)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Who is in the chair now, or who is next: the calm brand gradient card (Clear Glass drops the blob)
/// with a live dot, the day's progress ring and Open record.
struct TodayHero: View {
    let kind: HeroKind
    let item: ScheduleItem
    let progress: Double
    let done: Int
    let total: Int
    let onOpen: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let kicker = [
            String(localized: kind == .now ? "t7.hero.now" : "t7.hero.next", table: "TodayV7"),
            TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay)),
            item.room,
        ].compactMap { $0 }.joined(separator: " · ")
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                SkLiveDot()
                Text(kicker).skTextStyle(SkTypeScale.overline).foregroundStyle(Color.white.opacity(0.9)).lineLimit(2)
            }
            .padding(.trailing, 52)
            Text(item.patientName).font(.system(size: 18, weight: .heavy)).tracking(-0.2)
                .foregroundStyle(r.onPrimary.color).padding(.trailing, 54)
            if let reason = item.reason {
                Text(reason).font(.system(size: 12)).foregroundStyle(r.onPrimary.color.opacity(0.88))
            }
            Button(action: onOpen) {
                Text("t7.hero.open", tableName: "TodayV7").font(.system(size: 12.5, weight: .bold)).foregroundStyle(r.primary.color)
                    .padding(.horizontal, 14).frame(minHeight: 36).background(Color.white, in: Capsule())
            }
            .buttonStyle(.skPressable)
            .padding(.top, 4)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            LinearGradient(colors: [r.primary.color, r.primary2.color], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
        .overlay(alignment: .topTrailing) {
            SkProgressRing(
                fraction: progress, label: "\(done)/\(total)",
                description: String(format: String(localized: "t7.hero.ring", table: "TodayV7"), done, total),
                color: .white, size: 46
            )
            .padding(13)
        }
        .clipShape(RoundedRectangle(cornerRadius: GroupedSizes.radius + 2, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .accessibilityElement(children: .contain)
    }
}

/// Collected today and Expenses today (owner and finance), with "+ Add expense".
struct MoneyCards: View {
    let money: MoneyView
    let onAddExpense: (() -> Void)?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(alignment: .top, spacing: 10) {
            SkCard(padding: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("t7.money.collected", tableName: "TodayV7").skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                    Text(ClinicFormat.rupees(paise: money.collectedPaise)).font(.system(size: 16, weight: .heavy)).foregroundStyle(r.onSurface.color)
                    Text(String(format: String(localized: "t7.money.dues", table: "TodayV7"), ClinicFormat.rupees(paise: money.pendingDuesPaise)))
                        .skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            .frame(maxHeight: .infinity)
            Button { onAddExpense?() } label: {
                SkCard(padding: 14) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("t7.money.expenses", tableName: "TodayV7").skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                        Text(money.expensesTodayPaise.map { ClinicFormat.rupees(paise: $0.int64Value) } ?? "—")
                            .font(.system(size: 16, weight: .heavy)).foregroundStyle(r.onSurface.color)
                        if onAddExpense != nil {
                            Text("t7.money.add_expense", tableName: "TodayV7").skTextStyle(SkTypeScale.caption).fontWeight(.bold)
                                .foregroundStyle(r.primary.color)
                        }
                    }
                }
            }
            .buttonStyle(.skPressable)
            .disabled(onAddExpense == nil)
            .frame(maxHeight: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
