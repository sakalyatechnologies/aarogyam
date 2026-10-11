import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Analytics page: the Week / Month / Year chips, KPI cards with deltas, the bar chart,
/// chair gauge, heat map, radar over visit kinds, age bands and spending. Charts the server
/// cannot fill yet are Preview cards.
struct AnalyticsScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let holder: AnalyticsStateHolder
    let state: AnalyticsState
    @State private var addExpense = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                switch onEnum(of: state) {
                case .loading(let loading):
                    PeriodChips(period: loading.period, onPick: holder.show)
                    SkLoadingIndicator(CL("c.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(CL("c.analytics.not_allowed.title"), message: CL("c.analytics.not_allowed.message"))
                case .failed(let failed):
                    PeriodChips(period: failed.period, onPick: holder.show)
                    SkEmptyState(CL("c.analytics.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    PeriodChips(period: loaded.view.period, onPick: holder.show)
                    AnalyticsCards(view: loaded.view, onAddExpense: clinic.permissions.contains("expenses.write") ? { addExpense = true } : nil)
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(theme.roles.background.color)
        .navigationTitle(CL("c.analytics.title"))
        .refreshable { holder.refresh() }
        .sheet(isPresented: $addExpense) { ExpenseSheetHost(graph: graph, clinic: clinic) { holder.refresh() } }
    }
}

private struct PeriodChips: View {
    let period: AnalyticsPeriod
    let onPick: (AnalyticsPeriod) -> Void

    var body: some View {
        HStack(spacing: SkControlSizes.chipGap) {
            ForEach(AnalyticsPeriod.allCases, id: \.self) { option in
                SkChoiceChip(option.label, selected: option == period) { onPick(option) }
            }
        }
        .padding(.top, 4)
    }
}

extension AnalyticsPeriod {
    var label: String {
        switch self {
        case .week: CL("c.analytics.week")
        case .month: CL("c.analytics.month")
        case .year: CL("c.analytics.year")
        }
    }

    /// What the KPI deltas compare against, for the card captions.
    var against: String {
        switch self {
        case .week: CL("c.analytics.vs_week")
        case .month: CL("c.analytics.vs_month")
        case .year: CL("c.analytics.vs_year")
        }
    }
}
