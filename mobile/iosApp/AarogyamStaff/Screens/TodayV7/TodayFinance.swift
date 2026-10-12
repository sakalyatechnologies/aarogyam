import AarogyamShared
import SakalyaUI
import SwiftUI

/// Today for a finance-only role: the me card (month target is a preview), the collected and
/// expenses cards with the UPI share, this month's revenue mix, and the parts the server cannot fill.
struct FinanceToday: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let money: MoneyView
    let error: String?
    let onAddExpense: (() -> Void)?
    let onEditAvatar: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 10) {
            if let error { Text(error).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color) }
            MePager(graph: graph, model: me, schedule: nil, onEditAvatar: onEditAvatar) { _ in }
                .padding(.top, 8)
            MoneyCards(money: money, onAddExpense: onAddExpense)
            upiShare
            if !money.mix.isEmpty { mix }
            TodaySectionHeader(title: String(localized: "t7.fin.dues", table: "TodayV7")).padding(.bottom, -4)
            PreviewNotice().padding(.leading, 2)
        }
        .padding(.horizontal, SkSpacing.l)
    }

    private var me: MeCardModel {
        let spent = money.expensesTodayPaise.map { ClinicFormat.rupees(paise: $0.int64Value) }
        let chips = [
            String(format: String(localized: "t7.fin.collected", table: "TodayV7"), ClinicFormat.rupees(paise: money.collectedPaise)),
            String(format: String(localized: "t7.money.dues", table: "TodayV7"), ClinicFormat.rupees(paise: money.pendingDuesPaise)),
        ] + (spent.map { [String(format: String(localized: "t7.fin.expenses", table: "TodayV7"), $0)] } ?? [])
        return MeCardModel(
            role: clinic.roleName, name: clinic.session.user.displayName, chips: chips,
            progress: .init(
                label: String(localized: "t7.fin.month_target", table: "TodayV7"),
                value: String(format: String(localized: "t7.fin.month", table: "TodayV7"), ClinicFormat.rupees(paise: money.collectedThisMonthPaise)),
                fraction: nil, isPreview: true
            )
        )
    }

    private var upiShare: some View {
        let r = theme.roles
        let upi = Double(money.upiShareBps) / 100
        return SkCard(padding: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("t7.fin.payments", tableName: "TodayV7").skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                    Spacer()
                    Text(String(format: String(localized: "t7.fin.payments_count", table: "TodayV7"), Int(money.paymentsToday)))
                        .skTextStyle(SkTypeScale.caption).foregroundStyle(r.onSurfaceVariant.color)
                }
                SkSplitBar([upi, max(100 - upi, 0)], colors: [r.primary.color, r.tertiary.color])
                SkLegend([
                    (String(format: String(localized: "t7.fin.upi", table: "TodayV7"), money.upiShareText), r.primary.color),
                    (String(localized: "t7.fin.other", table: "TodayV7"), r.tertiary.color),
                ])
            }
        }
    }

    private var mix: some View {
        let r = theme.roles
        let colors = [r.chart1, r.chart2, r.chart3, r.chart4, r.chart5].map(\.color)
        let top = Array(money.mix.prefix(5))
        return SkCard(padding: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("t7.fin.mix", tableName: "TodayV7").font(.system(size: 14.5, weight: .heavy)).foregroundStyle(r.onSurface.color)
                SkSplitBar(top.map { Double($0.shareBps) }, colors: colors)
                SkLegend(top.enumerated().map { ("\($1.category) · \(ClinicFormat.rupees(paise: $1.amountPaise))", colors[$0]) })
            }
        }
    }
}
