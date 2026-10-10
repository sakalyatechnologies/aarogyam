import AarogyamShared
import SakalyaUI
import SwiftUI

/// Visits, waiting (warm) and done as one joined row (`.stats`).
struct TodayStats: View {
    let counts: TodayCountsView

    var body: some View {
        SkStatGroup([
            SkStat("\(counts.visits)", label: String(localized: "t7.stat.visits", table: "TodayV7")),
            SkStat("\(counts.waiting)", label: String(localized: "t7.stat.waiting", table: "TodayV7"), highlighted: true),
            SkStat("\(counts.done)", label: String(localized: "t7.stat.done", table: "TodayV7")),
        ])
    }
}

/// Who is in the chair now, or who is next: the brand gradient card with a morphing blob, a live
/// dot, the day's progress ring and Open record.
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
            ZStack(alignment: .topTrailing) {
                LinearGradient(colors: [r.primary.color, r.primary2.color], startPoint: .topLeading, endPoint: .bottomTrailing)
                SkMorphingBlob(color: r.primaryContainer.color.opacity(0.22)).frame(width: 170, height: 170).offset(x: 40, y: -50)
            }
        }
        .overlay(alignment: .topTrailing) {
            SkProgressRing(
                fraction: progress, label: "\(done)/\(total)",
                description: String(format: String(localized: "t7.hero.ring", table: "TodayV7"), done, total),
                color: .white, size: 46
            )
            .padding(13)
        }
        .clipShape(RoundedRectangle(cornerRadius: TodaySizes.heroRadius, style: .continuous))
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
